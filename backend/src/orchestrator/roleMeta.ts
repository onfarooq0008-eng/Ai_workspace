import { ALL_WORKER_ROLES, WorkerRole } from "./jsonParsing";

export interface RoleMeta {
  role: string;
  label: string;
  avatar: string; // emoji, used as the character's "head" in the Office View
  color: string; // CSS color for the character's desk/shirt
  description: string;
}

export const ROLE_META: Record<string, RoleMeta> = {
  manager: { role: "manager", label: "Manager", avatar: "🧑\u200d💼", color: "#6d87ff", description: "Plans the work and reports the final result." },
  planner: { role: "planner", label: "Planner", avatar: "🗂️", color: "#8b7bff", description: "Breaks the request into a task graph." },
  coder: { role: "coder", label: "Coder", avatar: "👩\u200d💻", color: "#4fb3ff", description: "Writes and modifies code." },
  researcher: { role: "researcher", label: "Researcher", avatar: "🔎", color: "#4fd1c5", description: "Investigates requirements and facts." },
  reviewer: { role: "reviewer", label: "Reviewer", avatar: "🧐", color: "#f6ad55", description: "Reviews work for correctness and clarity." },
  tester: { role: "tester", label: "Tester", avatar: "🧪", color: "#68d391", description: "Runs builds/tests and reports pass or fail." },
  security_reviewer: { role: "security_reviewer", label: "Security Reviewer", avatar: "🛡️", color: "#fc8181", description: "Looks for vulnerabilities." },
  ui_designer: { role: "ui_designer", label: "UI Designer", avatar: "🎨", color: "#f687b3", description: "Improves UI/UX." },
  documentation: { role: "documentation", label: "Documentation", avatar: "📝", color: "#b794f4", description: "Writes docs and guides." },
  debugger: { role: "debugger", label: "Debugger", avatar: "🐛", color: "#fbd38d", description: "Diagnoses and fixes failures." },
  devops: { role: "devops", label: "DevOps", avatar: "⚙️", color: "#90cdf4", description: "Build, deploy, CI/CD, process config." },
  database: { role: "database", label: "Database", avatar: "🗄️", color: "#81e6d9", description: "Schema, migrations, queries." },
  api_designer: { role: "api_designer", label: "API Designer", avatar: "🔌", color: "#faf089", description: "Designs/reviews API surfaces." },
  performance_optimizer: { role: "performance_optimizer", label: "Performance", avatar: "⚡", color: "#f6e05e", description: "Finds and fixes performance issues." },
  accessibility_reviewer: { role: "accessibility_reviewer", label: "Accessibility", avatar: "♿", color: "#9ae6b4", description: "Reviews for accessibility (WCAG)." },
  localization: { role: "localization", label: "Localization", avatar: "🌐", color: "#fbb6ce", description: "i18n/l10n readiness." },
};

export function allRolesMeta(): RoleMeta[] {
  return ["manager", "planner", ...ALL_WORKER_ROLES].map((r) => ROLE_META[r] || fallbackMeta(r));
}

function fallbackMeta(role: string): RoleMeta {
  return { role, label: role, avatar: "🤖", color: "#a0aec0", description: "" };
}

export function metaFor(role: string): RoleMeta {
  return ROLE_META[role] || fallbackMeta(role);
}

export { ALL_WORKER_ROLES };
export type { WorkerRole };
