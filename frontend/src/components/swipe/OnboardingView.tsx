import { Activity, Sparkles } from 'lucide-react';

import { archetypes } from '../../preference/archetypes';
import {
  createCandidateFromPlan,
  createFeatureVector
} from '../../preference/model';
import type { OnboardingState, PromptPlan } from '../../preference/types';
import { MiniPostCard } from './MiniPostCard';
import type { SetState } from './types';

type OnboardingViewProps = {
  onboarding: OnboardingState;
  setOnboarding: SetState<OnboardingState>;
  onStartSession: () => void;
  onOpenExperiments?: () => void;
};

export function OnboardingView({ onboarding, setOnboarding, onStartSession, onOpenExperiments }: OnboardingViewProps) {
  return (
    <div className="swipe-prototype swipe-prototype--onboarding">
      <main className="swipe-onboarding">
        <section className="swipe-onboarding__copy">
          <h1>Image card swipe simple</h1>
          <p>Swipe to steer image.</p>
          <div className="swipe-onboarding__preview" aria-hidden="true">
            {archetypes.slice(0, 3).map((item, index) => {
              const plan: PromptPlan = {
                id: `preview-${index}`,
                batchId: 'preview',
                strategy: item.strategy,
                hypothesis: '',
                prompt: item.prompt,
                negativePrompt: item.negativePrompt,
                targetAttributes: item.tags,
                intendedFeatures: createFeatureVector(item.features),
                rationale: '',
                scoreBreakdown: {
                  preferenceMatch: 0,
                  userGoalAlignment: 0,
                  diversityBonus: 0,
                  informationGain: 0,
                  repairValue: 0,
                  dislikedFeaturePenalty: 0,
                  finalScore: 0
                }
              };
              return (
                <MiniPostCard
                  key={item.name}
                  candidate={createCandidateFromPlan(plan, index)}
                  isActive={index === 1}
                />
              );
            })}
          </div>
        </section>

        <section className="swipe-onboarding__form" aria-label="Onboarding">
          <label>
            <span>Brand or project</span>
            <input
              value={onboarding.brandName}
              onChange={event => setOnboarding(current => ({ ...current, brandName: event.target.value }))}
            />
          </label>

          <label>
            <span>Category</span>
            <input
              value={onboarding.category}
              onChange={event => setOnboarding(current => ({ ...current, category: event.target.value }))}
            />
          </label>

          <label>
            <span>Post goal</span>
            <textarea
              value={onboarding.goal}
              onChange={event => setOnboarding(current => ({ ...current, goal: event.target.value }))}
              rows={3}
            />
          </label>

          <label>
            <span>Audience</span>
            <input
              value={onboarding.audience}
              onChange={event => setOnboarding(current => ({ ...current, audience: event.target.value }))}
            />
          </label>

          <button className="swipe-primary-button" type="button" onClick={onStartSession}>
            <Sparkles size={18} />
            Generate first 8
          </button>
          {onOpenExperiments ? (
            <button className="swipe-icon-text-button swipe-onboarding__secondary-action" type="button" onClick={onOpenExperiments}>
              <Activity size={16} />
              Experiment runs
            </button>
          ) : null}
        </section>
      </main>
    </div>
  );
}
