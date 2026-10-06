// Placeholder until the module is built: replace this folder (docs/MODULES.md).
import { stubModule } from "@/modules/_framework";

// Reads every other module's result for the suggested result, so it runs last.
export const definition = stubModule({ key: "conclusion", title: "Conclusion", dependsOn: "all" });
