import type React from "react";
import { CtaBannerSection } from "./landing/CtaBannerSection";
import { FeatureCardsSection } from "./landing/FeatureCardsSection";
import { HeroSection } from "./landing/HeroSection";
import { HowItWorksSection } from "./landing/HowItWorksSection";
import { LandingFooter } from "./landing/LandingFooter";

type LandingContentProps = {
  ctaSlot: React.ReactNode;
};

export default function LandingContent({ ctaSlot }: LandingContentProps) {
  return (
    <div className="min-h-screen bg-background font-sans">
      <HeroSection ctaSlot={ctaSlot} />
      <FeatureCardsSection />
      <HowItWorksSection />
      <CtaBannerSection ctaSlot={ctaSlot} />
      <LandingFooter />
    </div>
  );
}
