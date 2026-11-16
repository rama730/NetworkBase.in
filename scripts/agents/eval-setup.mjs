// Starting states for the coding jobs in tests/agents/requests.yaml (report G22, D22): `setup: node "$NB_EVAL_SETUP" <state>`.
// Runs in the linked eval folder; $NB is the CLI, NETWORKBASE_TOKEN and NETWORKBASE_API_URL the eval server's.
//   fresh     a small web project, pushed, with no change set open
//   open      fresh + yesterday's open change set "Refactor the API client"
//   comment   open + a review comment on it from the person
//   applied   fresh + the applied change set "Redesign the sign-in page" (to undo)
//   conflict  open + a teammate's newer version of the same lines in src/api/client.ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// $NB is "node <path to nb.mjs>" or "npx -y @networkbase/cli@2"; arguments go as a list, never through a shell.
const [cmd, ...pre] = String(process.env.NB).split(" ");
const nb = (args, cwd = process.cwd()) => execFileSync(cmd, [...pre, ...args], { cwd, stdio: "pipe", encoding: "utf8", env: process.env });
const write = (rel, text, root = process.cwd()) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };

const PROJECT = {
  "src/components/Button.tsx": "export function Button({ children }: { children: string }) {\n  return <button className=\"btn\">{children}</button>;\n}\n",
  "src/components/Header.tsx": "import { Button } from './Button';\n\nexport function Header() {\n  return <header><Button>Sign in</Button></header>;\n}\n",
  "src/pages/Login.tsx": "import { LoginForm } from '../auth/LoginForm';\n\nexport default function Login() {\n  return <main><LoginForm /></main>;\n}\n",
  "src/pages/Signup.tsx": "import { Button } from '../components/Button';\n\nexport default function Signup() {\n  return <main><Button>Create account</Button></main>;\n}\n",
  "src/auth/LoginForm.tsx": "import { Button } from '../components/Button';\n\nexport function LoginForm() {\n  return (\n    <form>\n      <input name=\"email\" />\n      <input name=\"password\" type=\"password\" />\n      <Button>Sign in</Button>\n    </form>\n  );\n}\n",
  "src/auth/login.css": "form {\n  display: grid;\n  gap: 8px;\n}\n",
  "src/api/client.ts": "export async function get(path: string) {\n  const res = await fetch(path);\n  return res.json();\n}\n",
};

/** A clean project on the server and here, with no change set open. */
function fresh() {
  try { nb(["change", "discard", "--yes"]); } catch { /* none open */ }
  try { nb(["file", "delete", "/src", "--yes"]); } catch { /* not there yet */ }
  fs.rmSync("src", { recursive: true, force: true });
  fs.rmSync(".networkbase/changes", { recursive: true, force: true });
  fs.rmSync(".networkbase/state.json", { force: true });
  for (const [rel, text] of Object.entries(PROJECT)) write(rel, text);
  nb(["push", ...Object.keys(PROJECT), "--no-task", "--yes", "-m", "Eval project"]);
}

/** Yesterday's work, left open: the API client half refactored. */
function open() {
  fresh();
  nb(["change", "start", "Refactor the API client"]);
  write("src/api/client.ts", "export async function get(path: string, init: RequestInit = {}) {\n  const res = await fetch(path, init);\n  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);\n  return res.json();\n}\n");
  nb(["change", "status"]);
}

async function comment() {
  open();
  const id = JSON.parse(fs.readFileSync(".networkbase/changes/current.json", "utf8")).id;
  const res = await fetch(`${process.env.NETWORKBASE_API_URL}/api/v1/change-sets/${id}/comments`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.NETWORKBASE_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ path: "/src/api/client.ts", line: 3, body: "Include the response body in the error, not just the status." }),
  });
  if (!res.ok) throw new Error(`comment: ${res.status} ${await res.text()}`);
}

function applied() {
  fresh();
  nb(["change", "start", "Redesign the sign-in page"]);
  write("src/auth/LoginForm.tsx", PROJECT["src/auth/LoginForm.tsx"].replace("<form>", "<form className=\"card\">"));
  write("src/auth/login.css", ".card {\n  display: grid;\n  gap: 12px;\n  padding: 24px;\n  border-radius: 8px;\n}\n");
  nb(["change", "apply", "--yes"]);
}

/** A teammate saves the same lines of src/api/client.ts in another folder after yesterday's set started. */
function conflict() {
  open();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "nb-eval-teammate-"));
  try {
    nb(["init", "design-lab", "--yes"], other);
    nb(["pull", "src/api/client.ts"], other);
    write("src/api/client.ts", "export async function get(path: string) {\n  const res = await fetch(path, { credentials: 'include' });\n  return res.json();\n}\n", other);
    nb(["push", "src/api/client.ts", "--no-task", "-m", "Send cookies"], other);
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
  }
}

const states = { fresh, open, comment, applied, conflict };
const state = process.argv[2];
if (!(state in states)) throw new Error(`No setup ${state}: ${Object.keys(states).join(", ")}`);
await states[state]();
