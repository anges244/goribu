import { Form } from "goribu";

export default function FormsPage({ message = "Choose a method." }) {
  return (
    <main>
      <h1>Form methods</h1>
      <p id="message">{message}</p>
      {["post", "put", "patch", "delete"].map((method) => (
        <Form key={method} id={`form-${method}`} method={method} action="/forms">
          {({ pending, errors, data }) => (
            <>
              <label>
                Name for {method.toUpperCase()}
                <input name="name" defaultValue="Ada" />
              </label>
              <button name="intent" value="save" disabled={pending}>{method.toUpperCase()}</button>
              <button name="intent" value="preview" disabled={pending}>Preview</button>
              <button name="intent" value="redirect" disabled={pending}>Redirect</button>
              {errors?.name ? <p role="alert">{errors.name}</p> : null}
              {data ? <output>{data.method}: {data.name}</output> : null}
            </>
          )}
        </Form>
      ))}
    </main>
  );
}

export function POST(req, res) { return submit(req, res); }
export function PUT(req, res) { return submit(req, res); }
export function PATCH(req, res) { return submit(req, res); }
export function DELETE(req, res) { return submit(req, res); }

async function submit(req, res) {
  const body = await req.body();
  const fields = body instanceof FormData ? Object.fromEntries(body) : body;
  req.cookies.set("last_method", req.method, { path: "/forms", httpOnly: true });
  res.headers({ "x-form-handler": req.method, etag: '"form-data"', vary: "Origin" });
  if (!fields.name?.trim()) return res.invalid({ name: "Enter a name." });
  if (fields.intent === "preview") return res.render({ message: `${req.method}: ${fields.name}` });
  if (fields.intent === "redirect") return res.redirect(`/forms?completed=${req.method}`);
  if (fields.intent === "plain") return res.text(`${req.method}: ${fields.name}`);
  return res.status(201).json({
    method: req.method,
    name: fields.name,
    intent: fields.intent,
    attachment: fields.attachment?.name ?? null,
  });
}
