export default function ServerErrorPage({ errorId }) {
  return (
    <main>
      <h1>Something went wrong</h1>
      <p>
        Error reference: <code>{errorId}</code>
      </p>
    </main>
  );
}
