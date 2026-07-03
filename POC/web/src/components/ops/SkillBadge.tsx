import type { OpsSkill } from "../../lib/opsMessages";

const SKILL_META: Record<OpsSkill, { label: string; color: string }> = {
  diagnostics: { label: "DIAGNOSTICS", color: "text-scout" },
  scaling: { label: "SCALING", color: "text-writer" },
  recovery: { label: "RECOVERY", color: "text-analyst" },
};

export function SkillBadge({ skill }: { skill?: OpsSkill }) {
  if (!skill) return null;
  const meta = SKILL_META[skill];
  return (
    <span className={`font-mono text-[9px] font-semibold uppercase tracking-wider ${meta.color}`}>
      {meta.label}
    </span>
  );
}
