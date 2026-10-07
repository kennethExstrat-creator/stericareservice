import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Logo } from "@/components/brand/logo";
import { PageHeader } from "@/components/qc";
import { isDesignPageEnabled } from "@/lib/design/design-page";
import { ButtonSection } from "./_components/button-section";
import { ColourSection } from "./_components/colour-section";
import { DefectSection } from "./_components/defect-section";
import { DesignIndex } from "./_components/design-index";
import { GridSection } from "./_components/grid-section";
import { HeaderSection } from "./_components/header-section";
import { InputSection } from "./_components/input-section";
import { LayoutSection } from "./_components/layout-section";
import { LogoSection } from "./_components/logo-section";
import { ModuleSection } from "./_components/module-section";
import { PhotoSection } from "./_components/photo-section";
import { PillSection } from "./_components/pill-section";
import { ProgressSection } from "./_components/progress-section";
import { StatusSection } from "./_components/status-section";
import { StepperSection } from "./_components/stepper-section";
import { TypeSection } from "./_components/type-section";

export const metadata: Metadata = {
  title: "Design Sign-Off",
};

export default async function DesignPage() {
  // Decided per request, so ENABLE_DESIGN_PAGE works on a running deployment.
  await connection();
  if (
    !isDesignPageEnabled({
      nodeEnv: process.env.NODE_ENV,
      enableDesignPage: process.env.ENABLE_DESIGN_PAGE,
    })
  ) {
    notFound();
  }

  return (
    <div className="flex-1">
      <header className="border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 md:px-6">
          <Logo variant="horizontal" loading="eager" />
          <span aria-hidden className="hidden h-6 w-px bg-border sm:block" />
          <p className="text-sm font-semibold text-foreground">Design Sign-Off</p>
          <p className="ml-auto text-sm text-muted-foreground">
            <span className="hidden touch:inline">Touch density: 44 px targets, 16 px fields</span>
            <span className="hidden fine:inline">Compact density (fine pointer)</span>
          </p>
        </div>
      </header>

      <DesignIndex variant="bar" className="xl:hidden" />

      <div className="xl:grid xl:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden border-r border-border bg-card xl:block">
          <DesignIndex variant="sidebar" />
        </aside>

        <main className="mx-auto w-full max-w-6xl space-y-16 px-4 py-8 md:px-6 md:py-10 xl:px-10">
          <PageHeader
            eyebrow="SteriCare QC · Phase 1"
            title="Design Sign-Off"
            description="The light SteriCare theme for the inspection app, built from the website's tokens. Check it at iPad portrait (820 px), iPad landscape (1180 px) and desktop (1440 px). Everything below is the real component, wired to sample data."
          />
          <LogoSection />
          <ColourSection />
          <StatusSection />
          <TypeSection />
          <ButtonSection />
          <InputSection />
          <StepperSection />
          <DefectSection />
          <GridSection />
          <PillSection />
          <ModuleSection />
          <PhotoSection />
          <ProgressSection />
          <HeaderSection />
          <LayoutSection />
        </main>
      </div>
    </div>
  );
}
