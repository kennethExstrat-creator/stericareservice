// The panel's focus targets (focus-handoff.tsx), one of each on the page. A
// plain module, not a "use client" one: Server Components pass these names to
// FocusTarget, and a Server Component only gets client references, not
// values, from a "use client" module.
export const AI_FOCUS = { attempt: "ai-attempt", opinion: "ai-opinion" } as const;
