import { createD1 } from "./create-d1.js";

const BOOKMARK_COOKIE = "goribu_d1_bookmark";
const FIRST_UNCONSTRAINED = "first-unconstrained";
const FIRST_PRIMARY = "first-primary";
const BOOKMARK_COOKIE_OPTIONS = Object.freeze({
  path: "/",
  maxAge: 3600,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
});

/**
 * Own the default D1 session and bookmark lifecycle for one Worker request.
 *
 * Creating the controller and building statements remain lazy: withSession() is called
 * only when a terminal method or valid atomic() operation actually reaches the database.
 * The dispatcher calls commit() after producing either a success or handled-error response
 * and before taking the final pending-cookie snapshot. The same best-effort finalization
 * hook retains the dormant recorder seam without installing instrumentation.
 *
 * @param {{
 *   resolver: () => object,
 *   cookieJar: {
 *     get(name: string): string|null,
 *     set(name: string, value: string, options?: object): void,
 *     delete(name: string, options?: object): void,
 *   },
 *   replication?: boolean,
 *   recorder?: { capture?(query: object): object, record(query: object): void, finish(): void },
 * }} options
 * @returns {{ d1: Function, commit(): void }}
 */
export function createD1RequestController({
  resolver,
  cookieJar,
  replication,
  recorder,
} = {}) {
  assertCookieJar(cookieJar);
  if (typeof resolver !== "function") {
    throw new TypeError(
      "[Goribu] createD1RequestController() requires the request's lazy D1 binding resolver. Pass createD1BindingResolver(env) from the application boundary.",
    );
  }

  if (replication === false) {
    const execution = addRecorder(createBindingExecution(resolver), recorder);
    let committed = false;
    return Object.freeze({
      d1: createD1(resolver, execution),
      commit() {
        if (committed) return;
        committed = true;
        finishRecorder(recorder);
      },
    });
  }

  const incomingBookmark = cookieJar.get(BOOKMARK_COOKIE);
  let session;
  let sessionOpeningError;
  let publicSession;
  let publicSessionOpeningError;
  let freshSession;
  let freshSessionOpeningError;
  let incomingBookmarkRejected = false;
  let committed = false;

  const execution = addRecorder(
    {
      prepare(sql, params) {
        return bindStatement(getDefaultSession(), sql, params);
      },
      batch(statements) {
        return getDefaultSession().batch(statements);
      },
    },
    recorder,
  );
  const freshExecution = addRecorder(
    {
      prepare(sql, params) {
        return bindStatement(openSession(FIRST_PRIMARY), sql, params);
      },
    },
    recorder,
  );
  const publicExecution = addRecorder(
    {
      prepare(sql, params) {
        return bindStatement(getPublicSession(), sql, params);
      },
    },
    recorder,
  );
  const d1 = createD1(resolver, execution, {
    getSession: getDefaultSession,
    fresh: {
      execution: freshExecution,
      getSession: getFreshSession,
    },
    public: {
      execution: publicExecution,
      getSession: getPublicSession,
    },
  });

  function getDefaultSession() {
    if (session !== undefined) return session;
    if (sessionOpeningError !== undefined) throw sessionOpeningError;

    try {
      const binding = resolver();
      assertSessionsSupported(binding);
      const constraint = incomingBookmark ?? FIRST_UNCONSTRAINED;
      let openedSession;
      try {
        openedSession = binding.withSession(constraint);
      } catch (cause) {
        if (incomingBookmark === null) {
          sessionOpeningError = cause;
          throw cause;
        }

        // Provisional until the live-D1 verification records whether stale bookmarks are
        // rejected here or by the first operation. Do not retry query execution based on an
        // unverified message heuristic: replaying a write after an ambiguous failure is unsafe.
        incomingBookmarkRejected = true;
        try {
          openedSession = binding.withSession(FIRST_UNCONSTRAINED);
        } catch (fallbackCause) {
          sessionOpeningError = fallbackCause;
          throw fallbackCause;
        }
      }

      assertSession(openedSession);
      session = openedSession;
      return session;
    } catch (cause) {
      sessionOpeningError = cause;
      throw cause;
    }
  }

  function getPublicSession() {
    if (publicSession !== undefined) return publicSession;
    if (publicSessionOpeningError !== undefined) throw publicSessionOpeningError;

    try {
      publicSession = openSession(FIRST_UNCONSTRAINED);
      return publicSession;
    } catch (error) {
      publicSessionOpeningError = error;
      throw error;
    }
  }

  function getFreshSession() {
    if (freshSession !== undefined) return freshSession;
    if (freshSessionOpeningError !== undefined) throw freshSessionOpeningError;

    try {
      freshSession = openSession(FIRST_PRIMARY);
      return freshSession;
    } catch (error) {
      freshSessionOpeningError = error;
      throw error;
    }
  }

  function openSession(constraint) {
    const binding = resolver();
    assertSessionsSupported(binding);
    const openedSession = binding.withSession(constraint);
    assertSession(openedSession);
    return openedSession;
  }

  function commit() {
    if (committed) return;
    committed = true;

    // Bookmark transport is best-effort. The application response already exists at this
    // point, so a platform getBookmark() surprise or malformed bookmark must degrade to no
    // freshness update, never discard the response or unrelated pending cookies.
    let bookmark = null;
    if (session !== undefined) {
      try {
        const candidate = session.getBookmark();
        if (candidate === null || (typeof candidate === "string" && candidate.length > 0)) {
          bookmark = candidate;
        }
      } catch {
        // Leave bookmark null and clear a rejected incoming bookmark below when necessary.
      }
    }

    try {
      if (bookmark !== null && bookmark !== incomingBookmark) {
        // Replacing the stale value clears it without emitting a redundant deletion first.
        cookieJar.set(BOOKMARK_COOKIE, bookmark, BOOKMARK_COOKIE_OPTIONS);
      } else if (incomingBookmarkRejected) {
        cookieJar.delete(BOOKMARK_COOKIE, { path: "/" });
      }
    } catch {
      // Cookie serialization is also best-effort and must not destroy the response.
    }

    finishRecorder(recorder);
  }

  return Object.freeze({ d1, commit });
}

function createBindingExecution(resolveBinding) {
  return {
    prepare(sql, params) {
      return bindStatement(resolveBinding(), sql, params);
    },
    batch(statements) {
      return resolveBinding().batch(statements);
    },
  };
}

function addRecorder(execution, recorder) {
  if (recorder !== undefined) {
    if (typeof recorder.capture === "function") execution.capture = recorder.capture;
    execution.record = recorder.record;
  }
  return execution;
}

function finishRecorder(recorder) {
  try {
    recorder?.finish();
  } catch {
    // A custom or future recorder must keep the same best-effort response guarantee.
  }
}

function bindStatement(session, sql, params) {
  const prepared = session.prepare(sql);
  return params.length > 0 ? prepared.bind(...params) : prepared;
}

function assertCookieJar(cookieJar) {
  if (
    cookieJar === null ||
    typeof cookieJar !== "object" ||
    typeof cookieJar.get !== "function" ||
    typeof cookieJar.set !== "function" ||
    typeof cookieJar.delete !== "function"
  ) {
    throw new TypeError(
      "[Goribu] createD1RequestController() requires the request's internal cookie jar. " +
        "Pass createCookieJar(request) so the D1 bookmark can be read and committed.",
    );
  }
}

function assertSessionsSupported(binding) {
  if (typeof binding.withSession !== "function") {
    throw new TypeError(
      "[Goribu] env.DB does not provide withSession(), but D1 sessions are enabled. " +
        "Use a Cloudflare D1 binding, or set database.replication to false in " +
        "goribu.config.js only when read replication is intentionally disabled.",
    );
  }
}

function assertSession(session) {
  if (
    session === null ||
    typeof session !== "object" ||
    typeof session.prepare !== "function" ||
    typeof session.batch !== "function" ||
    typeof session.getBookmark !== "function"
  ) {
    throw new TypeError(
      "[Goribu] env.DB.withSession() did not return a D1DatabaseSession. " +
        "Use the Cloudflare D1 binding supplied through env.DB without wrapping or replacing it.",
    );
  }
}
