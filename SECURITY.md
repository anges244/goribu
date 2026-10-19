# Security policy

## Supported versions

Goribu is before 1.0. Security fixes go into the next release of the latest
minor version; older versions are not patched. Upgrade to the newest `goribu`
and `create-goribu` releases to receive fixes.

## Reporting a vulnerability

Report vulnerabilities privately. Do not open a public issue or post details
on social media.

- Preferred: use **Report a vulnerability** on the repository's **Security**
  tab, which opens a private advisory visible only to the maintainer.
- Otherwise: email aggelos.gesoulis@gmail.com with "Goribu security" in the
  subject.

Include the affected Goribu version, the API or command involved, the smallest
app or steps that reproduce the problem, and the impact you observed.

Goribu is maintained by one person. You will get an acknowledgement as soon as
possible, usually within a week, and updates until the report is resolved.
Once a fix is released, the advisory is published with credit to the reporter
unless you ask to stay anonymous.

## Scope

This policy covers the `goribu` and `create-goribu` packages and the source in
this repository. A problem in an application built with Goribu is in scope when
the framework causes it, for example by leaking server code to the browser,
mishandling signed URLs, or serving user files unsafely. The test fixture and
example apps are not deployed and are not in scope.
