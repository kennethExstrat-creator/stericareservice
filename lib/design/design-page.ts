// The /design sign-off page is a development tool: shown outside production
// builds, or on a deployment that opts in (e.g. a Vercel preview for sign-off).

type DesignPageEnv = {
  nodeEnv: string | undefined;
  enableDesignPage: string | undefined;
};

export function isDesignPageEnabled({ nodeEnv, enableDesignPage }: DesignPageEnv): boolean {
  return nodeEnv !== "production" || enableDesignPage === "true";
}
