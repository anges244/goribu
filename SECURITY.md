# Security policy

## Supported versions

Goribu is before 1.0. Security fixes go into the next release of the latest
minor version and older versions are not patched. To receive fixes, upgrade to the newest `goribu` and `create-goribu` releases.

## Reporting a vulnerability

Report vulnerabilities privately with **Report a vulnerability** on the
repository's **Security** tab. This opens a private advisory that only I can
see. Do not open a public issue or post details on social media.

Include the affected Goribu version, the API or command involved, the smallest
app or steps that reproduce the problem, and the impact you observed.

Goribu is a one-person project, and I'm still figuring out how best to handle
reports. I'll reply as soon as I can and keep you updated until the issue is
fixed. When the fix is out, I'd like to credit you in the advisory, unless
you'd rather not be named.

## Scope

This policy covers the `goribu` and `create-goribu` packages and the source in
this repository. A problem in an application built with Goribu is in scope when
the framework causes it, for example by leaking server code to the browser,
mishandling signed URLs or serving user files unsafely. The test fixture and
example apps are not deployed and are not in scope.
