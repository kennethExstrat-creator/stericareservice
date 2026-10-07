import { SendIcon } from "lucide-react";
import { PageHeader, SaveStatus } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { DesignSection, Specimen } from "./design-section";

export function HeaderSection() {
  return (
    <DesignSection
      id="header"
      description="The website's eyebrow with its gradient dash, a Red Hat Display title and the page's actions. The gradient may accent a word of a large title; nowhere smaller."
      source="ui.tsx.txt (Eyebrow, SectionHeading)"
    >
      <Specimen>
        <PageHeader
          eyebrow="Preshipment Inspection"
          title={
            <>
              INS-2026-0001 <span className="text-gradient-brand">Nitrile EG</span>
            </>
          }
          description="Example manufacturer · PO-0001 · Template STD_EG v3 · Started 6 Oct 2026"
          actions={
            <>
              <SaveStatus state="saved" />
              <Button>
                <SendIcon aria-hidden />
                Submit
              </Button>
            </>
          }
        />
      </Specimen>
    </DesignSection>
  );
}
