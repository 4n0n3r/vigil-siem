import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { HeroSection } from "@/components/sections/HeroSection";
import { TrustBand } from "@/components/sections/TrustBand";
import { FeatureCards } from "@/components/sections/FeatureCards";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { AgentDemoSection } from "@/components/sections/AgentDemoSection";
import { AgentPositioning } from "@/components/sections/AgentPositioning";
import { DetectionCoverage } from "@/components/sections/DetectionCoverage";
import { SigmaShowcase } from "@/components/sections/SigmaShowcase";
import { FinalCTA } from "@/components/sections/FinalCTA";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-bg-primary">
      <Navbar />
      <HeroSection />
      <TrustBand />
      <FeatureCards />
      <HowItWorks />
      <AgentDemoSection />
      <AgentPositioning />
      <DetectionCoverage />
      <SigmaShowcase />
      <FinalCTA />
      <Footer />
    </main>
  );
}
