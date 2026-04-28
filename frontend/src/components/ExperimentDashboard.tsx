import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ImageIcon,
  Layers,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Target,
  ThumbsDown,
  ThumbsUp,
  X
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { API_BASE_URL, apiFetch } from '../api';
import './ExperimentDashboard.css';

type ExperimentStatus = 'running' | 'finished' | 'failed' | 'stalled' | 'draft';

type SteeringSnapshot = {
  batchNumber: number;
  phase: string;
  preferenceSummary: string;
  semanticBrief: string;
  leanInto: string[];
  avoidFacets: string[];
  testNext: string[];
  strategyMix: string[];
};

type ExperimentRecord = {
  batch: number;
  imageId: string;
  planId: string;
  strategy: string;
  imageUrl: string;
  imageSummary: string;
  action: 'like' | 'dislike' | 'pending' | string;
  score: number;
  targetFitScore?: number | null;
  selectedReasons: string[];
  specificReason: string;
  progressNotes: string;
  visibleProblems: string[];
  preferenceSummaryAfter?: string;
  planHypothesis?: string;
  planPrompt?: string;
  planNegativePrompt?: string;
  planTargetAttributes?: string[];
  pending?: boolean;
};

type ExperimentBatch = {
  batchNumber: number;
  steering: SteeringSnapshot | null;
  nextSteering: SteeringSnapshot | null;
  records: ExperimentRecord[];
};

type ExperimentRunSummary = {
  id: string;
  runName: string;
  status: ExperimentStatus;
  startedAt: string;
  updatedAt: string;
  targetImageUrl: string;
  targetBrief: string;
  recordCount: number;
  batchCount: number;
  latestBatch: number;
  targetScore?: number | null;
  bestScore: number;
  satisfiedCount: number;
  finalKind: 'satisfied' | 'best' | 'none';
  finalImageUrl: string;
  bestImageUrl: string;
  latestLogLine: string;
};

type ExperimentRunDetail = ExperimentRunSummary & {
  config: {
    targetBrief?: string;
    onboarding?: {
      brandName?: string;
      category?: string;
      goal?: string;
      audience?: string;
    };
  };
  targetUnderstanding?: {
    imageDescription?: string;
    normalUserRationale?: string;
    targetBrief?: string;
  };
  preferenceState?: {
    summary?: string;
    currentGenerationGuidance?: {
      leanInto?: string[];
      avoid?: string[];
      testNext?: string[];
      semanticBrief?: string;
    };
  };
  batches: ExperimentBatch[];
  finalRecord: ExperimentRecord | null;
  bestRecord: ExperimentRecord | null;
};

type ExperimentListResponse = {
  runs: ExperimentRunSummary[];
  activeCount: number;
  updatedAt: string;
};

type TraceNodeKind = 'intent' | 'batch' | 'final';

type TraceNode = {
  id: string;
  kind: TraceNodeKind;
  eyebrow: string;
  title: string;
  description: string;
  batchNumber?: number;
  imageUrl?: string;
  score?: number | null;
  records?: ExperimentRecord[];
  steering?: SteeringSnapshot | null;
  nextSteering?: SteeringSnapshot | null;
  finalRecord?: ExperimentRecord | null;
  subtitle?: string;
};

type PreviewImage = {
  url: string;
  title: string;
  meta?: string;
};

type ExperimentDashboardProps = {
  onOpenPrototype: () => void;
};

function assetUrl(url?: string) {
  if (!url) {
    return '';
  }
  if (url.startsWith('http') || url.startsWith('data:')) {
    return url;
  }
  return `${API_BASE_URL}${url}`;
}

function formatDate(value: string) {
  if (!value) {
    return 'Not started';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function formatScore(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'Pending';
  }
  return `${Math.round(value * 100)}%`;
}

function compactText(value: string | undefined, fallback = 'No notes yet.') {
  const cleaned = (value || '').trim();
  return cleaned || fallback;
}

function conciseText(value: string | undefined, fallback = 'No notes yet.', maxLength = 180) {
  const cleaned = compactText(value, fallback).replace(/\s+/g, ' ');
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength - 3).trim()}...`;
}

function shortItems(items: string[] | undefined, limit = 4, maxLength = 72) {
  return (items || [])
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map(item => conciseText(item, '', maxLength));
}

function facetItems(items: string[] | undefined, limit = 4) {
  return shortItems(
    (items || []).filter(item => item.length <= 110 && !/[.;!?]/.test(item)),
    limit,
    54
  );
}

function statusLabel(status: ExperimentStatus) {
  switch (status) {
    case 'running':
      return 'Running';
    case 'finished':
      return 'Finished';
    case 'failed':
      return 'Failed';
    case 'stalled':
      return 'Stalled';
    default:
      return 'Draft';
  }
}

function statusIcon(status: ExperimentStatus) {
  if (status === 'running') {
    return <Activity size={15} />;
  }
  if (status === 'finished') {
    return <CheckCircle2 size={15} />;
  }
  if (status === 'failed' || status === 'stalled') {
    return <AlertTriangle size={15} />;
  }
  return <Clock3 size={15} />;
}

function actionIcon(action: string) {
  if (action === 'like') {
    return <ThumbsUp size={13} />;
  }
  if (action === 'dislike') {
    return <ThumbsDown size={13} />;
  }
  return <Clock3 size={13} />;
}

function actionLabel(action: string) {
  if (action === 'like') {
    return 'Liked';
  }
  if (action === 'dislike') {
    return 'Disliked';
  }
  return 'Pending';
}

function feedbackForRecord(record: ExperimentRecord) {
  const selectedReasons = shortItems(record.selectedReasons, 3);
  return (
    record.specificReason ||
    selectedReasons.join('; ') ||
    record.progressNotes ||
    record.imageSummary ||
    (record.action === 'pending' ? 'Waiting for feedback.' : 'No written feedback.')
  );
}

function bestRecordIn(records: ExperimentRecord[] = []) {
  return records.reduce<ExperimentRecord | null>((best, record) => {
    if (record.action === 'pending') {
      return best;
    }
    return !best || record.score > best.score ? record : best;
  }, null);
}

function traceNodeIcon(kind: TraceNodeKind) {
  if (kind === 'intent') {
    return <Target size={17} />;
  }
  if (kind === 'batch') {
    return <Layers size={17} />;
  }
  return <Sparkles size={17} />;
}

function buildTraceNodes(detail: ExperimentRunDetail, targetImageUrl: string, finalRecord: ExperimentRecord | null): TraceNode[] {
  const nodes: TraceNode[] = [
    {
      id: 'intent',
      kind: 'intent',
      eyebrow: 'Start',
      title: 'Intent goal',
      description: compactText(
        detail.targetUnderstanding?.normalUserRationale ||
          detail.targetUnderstanding?.imageDescription ||
          detail.targetBrief,
        'Target image and onboarding define the first search space.'
      ),
      imageUrl: targetImageUrl
    }
  ];

  detail.batches.forEach(batch => {
    const bestInBatch = bestRecordIn(batch.records);
    const reviewedCount = batch.records.filter(record => record.action !== 'pending').length;
    nodes.push({
      id: `batch-${batch.batchNumber}`,
      kind: 'batch',
      eyebrow: `Batch ${batch.batchNumber}`,
      title: `${batch.records.length} images`,
      subtitle: batch.nextSteering
        ? `${reviewedCount} feedback shaped next`
        : reviewedCount
          ? `${reviewedCount} feedback`
          : 'waiting for feedback',
      description: bestInBatch
        ? compactText(bestInBatch.imageSummary, 'Generated candidates reviewed.')
        : 'Generated candidates are waiting for review.',
      batchNumber: batch.batchNumber,
      imageUrl: bestInBatch?.imageUrl || batch.records[0]?.imageUrl,
      records: batch.records,
      steering: batch.steering,
      nextSteering: batch.nextSteering,
      score: bestInBatch?.score ?? null
    });
  });

  nodes.push({
    id: 'final',
    kind: 'final',
    eyebrow: detail.finalKind === 'satisfied' ? 'Satisfied' : 'Best so far',
    title: finalRecord ? 'Final image' : 'No endpoint yet',
    description: compactText(finalRecord?.progressNotes || finalRecord?.imageSummary, 'No final image has been selected.'),
    imageUrl: finalRecord?.imageUrl || detail.finalImageUrl || detail.bestImageUrl,
    score: finalRecord?.score ?? null,
    finalRecord
  });

  return nodes;
}

function GuidanceList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) {
    return null;
  }
  return (
    <div className="experiment-guidance-list">
      <span>{title}</span>
      <div>
        {items.map((item, index) => (
          <em key={`${item}-${index}`}>{item}</em>
        ))}
      </div>
    </div>
  );
}

function EmptyImage({ label }: { label: string }) {
  return (
    <div className="experiment-empty-image">
      <ImageIcon size={24} />
      <span>{label}</span>
    </div>
  );
}

function ExperimentImageCard({ record }: { record: ExperimentRecord; key?: string }) {
  const image = assetUrl(record.imageUrl);
  const selectedReasons = shortItems(record.selectedReasons, 3);
  const feedbackText = feedbackForRecord(record);

  return (
    <article className="experiment-image-card">
      <div className="experiment-image-card__media">
        {image ? <img src={image} alt={record.imageSummary || record.planId} /> : <EmptyImage label="No image" />}
      </div>
      <div className="experiment-image-card__body">
        <div className="experiment-image-card__meta">
          <span className={`experiment-action-pill experiment-action-pill--${record.action}`}>
            {actionIcon(record.action)}
            {actionLabel(record.action)}
          </span>
          <strong>{record.action === 'pending' ? 'Pending' : formatScore(record.score)}</strong>
        </div>
        <h3>{compactText(record.imageSummary || record.planHypothesis, record.planId)}</h3>
        {record.strategy ? <span className="experiment-strategy">{record.strategy.replace('_', ' ')}</span> : null}
        <p>
          <b>Feedback</b>
          {feedbackText}
        </p>
        {selectedReasons.length ? (
          <div className="experiment-mini-chips">
            {selectedReasons.map((reason, index) => (
              <em key={`${reason}-${index}`}>{reason}</em>
            ))}
          </div>
        ) : null}
        {record.progressNotes ? <p className="experiment-card-note">{record.progressNotes}</p> : null}
        {record.planHypothesis || record.planPrompt ? (
          <details className="experiment-plan-details">
            <summary>Prompt plan</summary>
            {record.planHypothesis ? <p>{record.planHypothesis}</p> : null}
            {record.planPrompt ? <p>{record.planPrompt}</p> : null}
            {record.planNegativePrompt ? <p>Avoid: {record.planNegativePrompt}</p> : null}
          </details>
        ) : null}
      </div>
    </article>
  );
}

function TraceImageStack({
  records,
  imageUrl,
  imageLabel = 'Image'
}: {
  records?: ExperimentRecord[];
  imageUrl?: string;
  imageLabel?: string;
}) {
  const recordImages =
    records
      ?.filter(record => Boolean(record.imageUrl))
      .slice(0, 6)
      .map(record => ({
        url: record.imageUrl,
        title: record.imageSummary || record.planId,
        meta: record.strategy ? record.strategy.replace('_', ' ') : `Batch ${record.batch}`
      })) || [];
  const stackImages = recordImages.length
    ? recordImages
    : imageUrl
      ? [{ url: imageUrl, title: imageLabel }]
      : [];

  if (!stackImages.length) {
    return <EmptyImage label="No images" />;
  }

  return (
    <div className="experiment-trace-stack" aria-label={imageLabel}>
      {stackImages.map((image, index) => (
        <span
          key={`${image.url}-${index}`}
          className="experiment-trace-stack__image"
          style={{
            '--stack-index': index,
            '--stack-count': stackImages.length
          } as CSSProperties}
        >
          <img src={assetUrl(image.url)} alt="" />
        </span>
      ))}
    </div>
  );
}

function TraceGraph({
  nodes,
  selectedNodeId,
  onSelectNode
}: {
  nodes: TraceNode[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
}) {
  return (
    <section className="experiment-traceboard" aria-label="Experiment progression traceboard">
      <div className="experiment-traceboard__header">
        <div>
          <span>Directed traceboard</span>
          <h2>Intent to final image</h2>
        </div>
      </div>

      <div className="experiment-trace-rail" role="list">
        {nodes.map((node, index) => (
          <div className="experiment-trace-step" key={node.id} role="listitem">
            <article
              className={`experiment-trace-node experiment-trace-node--${node.kind} ${
                node.id === selectedNodeId ? 'is-selected' : ''
              }`}
              aria-current={node.id === selectedNodeId ? 'step' : undefined}
              role="button"
              tabIndex={0}
              onClick={() => onSelectNode(node.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectNode(node.id);
                }
              }}
            >
              <div className="experiment-trace-node__label">
                <span className="experiment-trace-node__icon">{traceNodeIcon(node.kind)}</span>
                <span className="experiment-trace-node__eyebrow">{node.eyebrow}</span>
                <strong>{node.title}</strong>
                {node.subtitle ? <small>{node.subtitle}</small> : null}
              </div>
              <TraceImageStack
                records={node.records}
                imageUrl={node.imageUrl}
                imageLabel={node.title}
              />
            </article>
            {index < nodes.length - 1 ? (
              <div className="experiment-trace-arrow" aria-hidden="true">
                <ArrowRight size={20} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function FeedbackList({ records, limit = 8 }: { records: ExperimentRecord[]; limit?: number }) {
  const reviewed = records.filter(record => record.action !== 'pending').slice(0, limit);
  if (!reviewed.length) {
    return <div className="experiment-empty-row">No feedback has been applied yet.</div>;
  }

  return (
    <div className="experiment-feedback-list">
      {reviewed.map(record => (
        <article key={`${record.batch}-${record.planId}-${record.imageId}`}>
          <span className={`experiment-action-pill experiment-action-pill--${record.action}`}>
            {actionIcon(record.action)}
            {actionLabel(record.action)}
          </span>
          <p>{conciseText(record.specificReason || record.progressNotes || record.imageSummary)}</p>
          {shortItems(record.selectedReasons, 3).length ? (
            <div className="experiment-mini-chips">
              {shortItems(record.selectedReasons, 3).map((reason, index) => (
                <em key={`${reason}-${index}`}>{reason}</em>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function TraceGenerationList({
  records,
  onPreviewImage
}: {
  records: ExperimentRecord[];
  onPreviewImage: (image: PreviewImage) => void;
}) {
  if (!records.length) {
    return <div className="experiment-empty-row">No generated images for this node.</div>;
  }

  return (
    <div className="experiment-generation-list">
      {records.map(record => (
        <article className="experiment-generation-row" key={`${record.batch}-${record.planId}-${record.imageId}`}>
          {record.imageUrl ? (
            <button
              className="experiment-generation-row__image-button"
              type="button"
              onClick={() =>
                onPreviewImage({
                  url: record.imageUrl,
                  title: record.imageSummary || record.planId,
                  meta: record.strategy ? record.strategy.replace('_', ' ') : `Batch ${record.batch}`
                })
              }
              aria-label={`Open ${record.imageSummary || record.planId}`}
            >
              <img src={assetUrl(record.imageUrl)} alt="" />
            </button>
          ) : (
            <EmptyImage label="No image" />
          )}
          <div className="experiment-generation-row__body">
            <div className="experiment-generation-row__meta">
              <span className={`experiment-action-pill experiment-action-pill--${record.action}`}>
                {actionIcon(record.action)}
                {actionLabel(record.action)}
              </span>
              {record.strategy ? <em>{record.strategy.replace('_', ' ')}</em> : null}
            </div>
            <p>{feedbackForRecord(record)}</p>
            {shortItems(record.selectedReasons, 3).length ? (
              <div className="experiment-mini-chips">
                {shortItems(record.selectedReasons, 3).map((reason, index) => (
                  <em key={`${reason}-${index}`}>{reason}</em>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function ImagePreview({
  image,
  onClose
}: {
  image: PreviewImage;
  onClose: () => void;
}) {
  return (
    <div className="experiment-image-preview" role="dialog" aria-modal="true" aria-label={image.title}>
      <button className="experiment-image-preview__backdrop" type="button" aria-label="Close preview" onClick={onClose} />
      <figure>
        <button className="experiment-image-preview__close" type="button" onClick={onClose} aria-label="Close preview">
          <X size={18} />
        </button>
        <img src={assetUrl(image.url)} alt={image.title} />
        <figcaption>
          <strong>{image.title}</strong>
          {image.meta ? <span>{image.meta}</span> : null}
        </figcaption>
      </figure>
    </div>
  );
}

function TraceInspector({
  detail,
  node,
  onboarding,
  onPreviewImage
}: {
  detail: ExperimentRunDetail;
  node: TraceNode;
  onboarding: ExperimentRunDetail['config']['onboarding'];
  onPreviewImage: (image: PreviewImage) => void;
}) {
  const final = node.finalRecord || detail.finalRecord || detail.bestRecord;

  if (node.kind === 'intent') {
    return (
      <section className="experiment-trace-inspector">
        <div className="experiment-inspector-summary">
          <span>Selected node</span>
          <h2>Intent goal image</h2>
          <p>{node.description}</p>
          <dl>
            <div>
              <dt>Brand</dt>
              <dd>{onboarding?.brandName || 'Unset'}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{onboarding?.category || 'Unset'}</dd>
            </div>
            <div>
              <dt>Goal</dt>
              <dd>{onboarding?.goal || 'Unset'}</dd>
            </div>
            <div>
              <dt>Audience</dt>
              <dd>{onboarding?.audience || 'Unset'}</dd>
            </div>
          </dl>
        </div>
        <div className="experiment-inspector-media">
          {node.imageUrl ? <img src={assetUrl(node.imageUrl)} alt="Intent goal" /> : <EmptyImage label="No target" />}
        </div>
      </section>
    );
  }

  if (node.kind === 'final') {
    return (
      <section className="experiment-trace-inspector">
        <div className="experiment-inspector-summary">
          <span>Selected node</span>
          <h2>{detail.finalKind === 'satisfied' ? 'Satisfied endpoint' : 'Best final image'}</h2>
          <p>{node.description}</p>
          {final ? (
            <>
              <div className="experiment-inspector-score">
                <strong>{formatScore(final.score)}</strong>
                <span>{final.strategy ? final.strategy.replace('_', ' ') : 'final candidate'}</span>
              </div>
              <FeedbackList records={[final]} />
            </>
          ) : null}
        </div>
        <div className="experiment-inspector-media">
          {node.imageUrl ? <img src={assetUrl(node.imageUrl)} alt="Final experiment output" /> : <EmptyImage label="No result" />}
        </div>
      </section>
    );
  }

  const reviewedCount = node.records?.filter(record => record.action !== 'pending').length || 0;
  const nextSteering = node.nextSteering;

  return (
    <section className="experiment-trace-inspector experiment-trace-inspector--batch">
      <div className="experiment-inspector-summary">
        <span>Selected node</span>
        <h2>Batch {node.batchNumber}</h2>
        <p>{node.description}</p>
        <div className="experiment-inspector-score">
          <strong>{reviewedCount}</strong>
          <span>{reviewedCount === 1 ? 'feedback item' : 'feedback items'}</span>
        </div>
        <GuidanceList title="Generated with" items={facetItems(node.steering?.leanInto, 5)} />
        <GuidanceList title="Avoided" items={facetItems(node.steering?.avoidFacets, 5)} />
        {nextSteering ? (
          <div className="experiment-combined-steer">
            <span>Feedback shaped next batch</span>
            <p>{conciseText(nextSteering.semanticBrief || nextSteering.preferenceSummary)}</p>
            <GuidanceList title="Lean into" items={facetItems(nextSteering.leanInto, 6)} />
            <GuidanceList title="Avoid" items={facetItems(nextSteering.avoidFacets, 6)} />
            <GuidanceList title="Probe next" items={facetItems(nextSteering.testNext, 4)} />
            {nextSteering.strategyMix?.length ? (
              <div className="experiment-guidance-list">
                <span>Strategy mix</span>
                <div>
                  {shortItems(nextSteering.strategyMix, 5).map((strategy, index) => (
                    <em key={`${strategy}-${index}`}>{strategy.replace('_', ' ')}</em>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="experiment-inspector-column">
        <TraceGenerationList records={node.records || []} onPreviewImage={onPreviewImage} />
      </div>
    </section>
  );
}

function BatchSection({ batch }: { batch: ExperimentBatch }) {
  const steering = batch.steering;
  const nextSteering = batch.nextSteering;
  const bestInBatch = batch.records.reduce<ExperimentRecord | null>((best, record) => {
    if (record.action === 'pending') {
      return best;
    }
    return !best || record.score > best.score ? record : best;
  }, null);

  return (
    <section className="experiment-batch">
      <aside className="experiment-batch__steering">
        <span>Batch {batch.batchNumber}</span>
        <h2>{steering?.phase || 'Generation batch'}</h2>
        <GuidanceList title="Lean into" items={shortItems(steering?.leanInto, 5)} />
        <GuidanceList title="Avoid" items={shortItems(steering?.avoidFacets, 5)} />
        <GuidanceList title="Probe next" items={shortItems(steering?.testNext, 3)} />
      </aside>

      <div className="experiment-batch__body">
        <div className="experiment-batch__header">
          <div>
            <strong>{batch.records.length} images came out</strong>
            <span>
              {bestInBatch
                ? `Best in batch ${formatScore(bestInBatch.score)}`
                : 'Awaiting reviewed images'}
            </span>
          </div>
          {steering?.strategyMix?.length ? (
            <div className="experiment-strategy-row">
              {shortItems(steering.strategyMix, 5).map((strategy, index) => (
                <em key={`${strategy}-${index}`}>{strategy.replace('_', ' ')}</em>
              ))}
            </div>
          ) : null}
        </div>

        {batch.records.length ? (
          <div className="experiment-card-grid">
            {batch.records.map(record => (
              <ExperimentImageCard key={`${record.batch}-${record.planId}-${record.imageId}`} record={record} />
            ))}
          </div>
        ) : (
          <div className="experiment-empty-row">Prompt plans are ready. Images have not landed yet.</div>
        )}

        {nextSteering ? (
          <div className="experiment-next-steer">
            <span>Subsequent steer</span>
            <p>{compactText(nextSteering.preferenceSummary || nextSteering.semanticBrief)}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function ExperimentDashboard({ onOpenPrototype }: ExperimentDashboardProps) {
  const [runs, setRuns] = useState<ExperimentRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExperimentRunDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRunsCollapsed, setIsRunsCollapsed] = useState(false);
  const [selectedTraceNodeId, setSelectedTraceNodeId] = useState('intent');
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const [error, setError] = useState('');

  const selectedSummary = useMemo(
    () => runs.find(run => run.id === selectedRunId) || runs[0] || null,
    [runs, selectedRunId]
  );

  const loadRuns = useCallback(async (quiet = false) => {
    if (!quiet) {
      setIsLoading(true);
    }
    setIsRefreshing(true);
    setError('');
    try {
      const response = await apiFetch('/api/experiments/runs');
      if (!response.ok) {
        throw new Error(`Experiment list failed with ${response.status}`);
      }
      const data = (await response.json()) as ExperimentListResponse;
      const nextRuns = data.runs || [];
      setRuns(nextRuns);
      setSelectedRunId(current =>
        current && nextRuns.some(run => run.id === current) ? current : nextRuns[0]?.id ?? null
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load experiment runs.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const loadDetail = useCallback(async (runId: string) => {
    try {
      const response = await apiFetch(`/api/experiments/runs/${encodeURIComponent(runId)}`);
      if (!response.ok) {
        throw new Error(`Experiment detail failed with ${response.status}`);
      }
      setDetail((await response.json()) as ExperimentRunDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load experiment details.');
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (selectedRunId) {
      void loadDetail(selectedRunId);
    } else {
      setDetail(null);
    }
  }, [loadDetail, selectedRunId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadRuns(true);
      if (selectedRunId) {
        void loadDetail(selectedRunId);
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, [loadDetail, loadRuns, selectedRunId]);

  useEffect(() => {
    if (detail?.id) {
      setSelectedTraceNodeId(detail.batches[0] ? `batch-${detail.batches[0].batchNumber}` : 'intent');
    }
  }, [detail?.id]);

  useEffect(() => {
    if (!previewImage) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewImage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewImage]);

  const activeCount = runs.filter(run => run.status === 'running').length;
  const targetImage = assetUrl(detail?.targetImageUrl || selectedSummary?.targetImageUrl);
  const finalRecord = detail?.finalRecord || detail?.bestRecord || null;
  const onboarding = detail?.config?.onboarding || {};
  const traceNodes = useMemo(
    () => (detail ? buildTraceNodes(detail, detail.targetImageUrl || selectedSummary?.targetImageUrl || '', finalRecord) : []),
    [detail, finalRecord, selectedSummary?.targetImageUrl]
  );
  const selectedTraceNode = traceNodes.find(node => node.id === selectedTraceNodeId) || traceNodes[0] || null;

  return (
    <div className="experiment-shell">
      <header className="experiment-topbar">
        <div>
          <span>Headless steering</span>
          <strong>Experiment runs</strong>
        </div>
        <div className="experiment-topbar__status">
          <span className={activeCount ? 'is-live' : ''}>{activeCount ? `${activeCount} active` : 'No active runs'}</span>
          <span>{runs.length} total</span>
        </div>
        <div className="experiment-topbar__actions">
          <button type="button" onClick={() => void loadRuns()} disabled={isRefreshing}>
            <RefreshCw size={16} />
            Refresh
          </button>
          <button type="button" onClick={onOpenPrototype}>
            <SlidersHorizontal size={16} />
            Swipe prototype
          </button>
        </div>
      </header>

      <main className={`experiment-layout ${isRunsCollapsed ? 'is-runs-collapsed' : ''}`}>
        <aside
          className={`experiment-sidebar ${isRunsCollapsed ? 'experiment-sidebar--collapsed' : ''}`}
          aria-label="Experiment run list"
        >
          {isRunsCollapsed ? (
            <button
              className="experiment-sidebar__restore"
              type="button"
              onClick={() => setIsRunsCollapsed(false)}
              aria-label="Expand runs list"
            >
              <ChevronRight size={16} />
              <span>Runs</span>
              <small>{runs.length}</small>
            </button>
          ) : (
            <>
              <div className="experiment-sidebar__heading">
                <div>
                  <h2>Runs</h2>
                  <p>{isLoading ? 'Loading...' : `${runs.length} tracked`}</p>
                </div>
                <button
                  className="experiment-sidebar__toggle"
                  type="button"
                  onClick={() => setIsRunsCollapsed(true)}
                  aria-label="Collapse runs list"
                >
                  <ChevronLeft size={16} />
                </button>
              </div>
              {runs.length ? (
                <div className="experiment-run-list">
                  {runs.map(run => (
                    <button
                      key={run.id}
                      className={`experiment-run-row ${run.id === selectedRunId ? 'is-selected' : ''}`}
                      type="button"
                      onClick={() => setSelectedRunId(run.id)}
                    >
                      <span className={`experiment-status experiment-status--${run.status}`}>
                        {statusIcon(run.status)}
                        {statusLabel(run.status)}
                      </span>
                      <strong>{run.runName}</strong>
                      <span>{formatDate(run.startedAt)}</span>
                      <small>{run.recordCount} reviewed · {run.latestBatch || run.batchCount} batches</small>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="experiment-empty-row">No experiment runs found.</div>
              )}
            </>
          )}
        </aside>

        <section className="experiment-detail">
          {error ? <div className="experiment-error">{error}</div> : null}
          {!detail && isLoading ? <div className="experiment-empty-row">Loading experiment detail...</div> : null}
          {detail ? (
            <>
              <section className="experiment-overview">
                <div className="experiment-target-block">
                  <div className="experiment-target-block__image">
                    {targetImage ? <img src={targetImage} alt="Intent goal" /> : <EmptyImage label="No target" />}
                  </div>
                  <div>
                    <span>Intent goal image</span>
                    <h1>{detail.runName}</h1>
                    <p>
                      {compactText(
                        detail.targetUnderstanding?.normalUserRationale ||
                          detail.targetUnderstanding?.imageDescription ||
                          detail.targetBrief
                      )}
                    </p>
                    <dl>
                      <div>
                        <dt>Brand</dt>
                        <dd>{onboarding.brandName || 'Unset'}</dd>
                      </div>
                      <div>
                        <dt>Goal</dt>
                        <dd>{onboarding.goal || 'Unset'}</dd>
                      </div>
                      <div>
                        <dt>Audience</dt>
                        <dd>{onboarding.audience || 'Unset'}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </section>

              {traceNodes.length ? (
                <TraceGraph
                  nodes={traceNodes}
                  selectedNodeId={selectedTraceNode?.id || 'intent'}
                  onSelectNode={setSelectedTraceNodeId}
                />
              ) : null}

              {selectedTraceNode ? (
                <TraceInspector
                  detail={detail}
                  node={selectedTraceNode}
                  onboarding={onboarding}
                  onPreviewImage={setPreviewImage}
                />
              ) : null}
            </>
          ) : null}
        </section>
      </main>
      {previewImage ? <ImagePreview image={previewImage} onClose={() => setPreviewImage(null)} /> : null}
    </div>
  );
}
