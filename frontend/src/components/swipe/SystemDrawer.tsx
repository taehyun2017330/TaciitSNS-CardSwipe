import {
  Braces,
  History,
  Layers,
  MessageCircleQuestion,
  X
} from 'lucide-react';

import type {
  BubbleAction,
  FeedbackEvent,
  PreferenceFacet,
  PreferenceState,
  PromptPlan,
  TraceEvent
} from '../../preference/types';
import { formatTime } from '../../preference/utils';

type SystemDrawerProps = {
  batchNumber: number;
  bubbleAction: BubbleAction;
  feedbackEvents: FeedbackEvent[];
  onBubbleAnswer: (answer: string) => void;
  onClose: () => void;
  onForgetSavedMemory: () => void;
  preferenceState: PreferenceState;
  rankedPlanList: PromptPlan[];
  selectedPlanIds: Set<string>;
  showClarification: boolean;
  topNegative: PreferenceFacet[];
  topPositive: PreferenceFacet[];
  traceEvents: TraceEvent[];
};

export function SystemDrawer({
  batchNumber,
  bubbleAction,
  feedbackEvents,
  onBubbleAnswer,
  onClose,
  onForgetSavedMemory,
  preferenceState,
  rankedPlanList,
  selectedPlanIds,
  showClarification,
  topNegative,
  topPositive,
  traceEvents
}: SystemDrawerProps) {
  return (
    <aside className="swipe-system-drawer" aria-label="System debug panel">
      <div className="swipe-system-drawer__header">
        <div className="swipe-section-heading">
          <Braces size={16} />
          <h2>System</h2>
        </div>
        <button className="swipe-icon-button" type="button" title="Close system panel" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <section className="swipe-rail-block swipe-rail-block--summary">
        <div className="swipe-section-heading">
          <Layers size={16} />
          <h2>Preference memory</h2>
        </div>
        <p>{preferenceState.summary}</p>
        <dl>
          <div>
            <dt>State</dt>
            <dd>v{preferenceState.version}</dd>
          </div>
          <div>
            <dt>Swipes</dt>
            <dd>{feedbackEvents.length}</dd>
          </div>
          <div>
            <dt>Batch</dt>
            <dd>{batchNumber}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="swipe-link-button"
          onClick={onForgetSavedMemory}
          title="Wipe persisted state for this brand"
        >
          Forget saved memory
        </button>
      </section>

      <section className="swipe-rail-block">
        <h3>Generation guidance</h3>
        <div className="swipe-guidance-list">
          <strong>Lean into</strong>
          <p>{preferenceState.currentGenerationGuidance.leanInto.join(', ') || 'Gathering evidence.'}</p>
          <strong>Avoid</strong>
          <p>{preferenceState.currentGenerationGuidance.avoid.join(', ') || 'No strong negatives yet.'}</p>
          <strong>Test next</strong>
          <p>{preferenceState.currentGenerationGuidance.testNext.join(', ') || 'No targeted uncertainty yet.'}</p>
          <strong>Semantic brief</strong>
          <p>{preferenceState.currentGenerationGuidance.semanticBrief || 'No semantic style brief yet.'}</p>
          <strong>Slate policy</strong>
          <p>{preferenceState.currentGenerationGuidance.strategyMix.join(', ')}</p>
        </div>
      </section>

      <section className="swipe-rail-block">
        <h3>Lean into</h3>
        <div className="swipe-weight-list">
          {topPositive.length ? topPositive.map(facet => (
            <div key={facet.feature} className="swipe-weight-item">
              <span>{facet.label}</span>
              <div>
                <i style={{ width: `${Math.round(Math.abs(facet.weight) * 100)}%` }} />
              </div>
              <em title="weight / confidence | alpha / beta">
                {facet.weight.toFixed(2)} / {facet.confidence.toFixed(2)} | {facet.alpha.toFixed(1)} / {facet.beta.toFixed(1)}
              </em>
            </div>
          )) : <p className="swipe-muted">No stable likes yet.</p>}
        </div>
      </section>

      <section className="swipe-rail-block">
        <h3>Avoid</h3>
        <div className="swipe-weight-list swipe-weight-list--negative">
          {topNegative.length ? topNegative.map(facet => (
            <div key={facet.feature} className="swipe-weight-item">
              <span>{facet.label}</span>
              <div>
                <i style={{ width: `${Math.round(Math.abs(facet.weight) * 100)}%` }} />
              </div>
              <em title="weight / confidence | alpha / beta">
                {facet.weight.toFixed(2)} / {facet.confidence.toFixed(2)} | {facet.alpha.toFixed(1)} / {facet.beta.toFixed(1)}
              </em>
            </div>
          )) : <p className="swipe-muted">No stable dislikes yet.</p>}
        </div>
      </section>

      {showClarification && (
        <section className={`swipe-ai-bubble swipe-ai-bubble--${bubbleAction.mode}`}>
          <div className="swipe-section-heading">
            <MessageCircleQuestion size={16} />
            <h2>Expert clarification</h2>
          </div>
          <span className="swipe-ai-mode">{bubbleAction.mode.replace('_', ' ')}</span>
          <p>{bubbleAction.message}</p>
          {bubbleAction.options.length ? (
            <div className="swipe-ai-options">
              {bubbleAction.options.map(option => (
                <button type="button" key={option} onClick={() => onBubbleAnswer(option)}>
                  {option}
                </button>
              ))}
            </div>
          ) : null}
          <p className="swipe-muted">{bubbleAction.internalReason}</p>
        </section>
      )}

      <section className="swipe-debug-panel">
        <div className="swipe-section-heading">
          <Braces size={16} />
          <h2>System debug</h2>
        </div>
        <div className="swipe-debug-grid">
          <div>
            <h3>Latest extracted facets</h3>
            {preferenceState.lastExtractedFacets.length ? (
              <ul>
                {preferenceState.lastExtractedFacets.map((facet, index) => (
                  <li key={`${facet.feature}-${index}`}>
                    <span>{facet.sentiment > 0 ? '+' : '-'}</span>
                    {facet.label}
                    <em>{facet.confidence.toFixed(2)}</em>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="swipe-muted">No explicit reason facets extracted yet.</p>
            )}
          </div>
          <div>
            <h3>Selected prompt plans</h3>
            <ul>
              {rankedPlanList.slice(0, 6).map(plan => (
                <li key={plan.id} className={selectedPlanIds.has(plan.id) ? 'is-selected' : ''}>
                  <span>{plan.strategy}</span>
                  {plan.hypothesis}
                  {plan.targetAttributes.length ? ` (${plan.targetAttributes.slice(0, 3).join(', ')})` : ''}
                  <em>{plan.scoreBreakdown.finalScore.toFixed(2)}</em>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="swipe-rail-block swipe-traceboard">
        <div className="swipe-section-heading">
          <History size={16} />
          <h2>Traceboard</h2>
        </div>
        <div className="swipe-trace-list">
          {traceEvents.slice(0, 9).map(event => (
            <article key={event.id}>
              <span>{formatTime(event.createdAt)}</span>
              <strong>{event.title}</strong>
              <p>{event.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
}
