import { useState } from "react";
import { meta } from "../_lib/counter.js";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((value) => value + 1)}>{meta.label}: {count}</button>;
}
