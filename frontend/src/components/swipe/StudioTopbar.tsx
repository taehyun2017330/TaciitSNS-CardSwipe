import { Activity, Braces, ChevronLeft } from 'lucide-react';

import type { OnboardingState } from '../../preference/types';

type StudioTopbarProps = {
  onboarding: OnboardingState;
  onBackToOnboarding: () => void;
  onOpenExperiments?: () => void;
  onToggleDebug: () => void;
};

export function StudioTopbar({ onboarding, onBackToOnboarding, onOpenExperiments, onToggleDebug }: StudioTopbarProps) {
  return (
    <header className="swipe-topbar">
      <div className="swipe-topbar__actions">
        <button className="swipe-icon-text-button" type="button" onClick={onBackToOnboarding}>
          <ChevronLeft size={17} />
          Onboarding
        </button>
        {onOpenExperiments ? (
          <button className="swipe-icon-text-button" type="button" onClick={onOpenExperiments}>
            <Activity size={17} />
            Runs
          </button>
        ) : null}
      </div>
      <div className="swipe-topbar__title">
        <span>{onboarding.category}</span>
        <strong>{onboarding.brandName}</strong>
      </div>
      <div className="swipe-topbar__actions swipe-topbar__actions--right">
        <button className="swipe-icon-text-button" type="button" onClick={onToggleDebug}>
          <Braces size={17} />
          System
        </button>
      </div>
    </header>
  );
}
