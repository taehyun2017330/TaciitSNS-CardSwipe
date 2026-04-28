import type { ImageCandidate } from '../../preference/types';

type MiniPostCardProps = {
  candidate: ImageCandidate;
  isActive?: boolean;
  key?: string;
};

export function MiniPostCard({ candidate, isActive = false }: MiniPostCardProps) {
  return (
    <div
      className={[
        'swipe-post-card',
        candidate.imageUrl ? 'swipe-post-card--real-image' : '',
        candidate.generationStatus === 'generating' ? 'is-generating' : '',
        candidate.generationStatus === 'failed' ? 'is-failed' : '',
        candidate.visual.paletteClass,
        candidate.visual.compositionClass,
        candidate.visual.textureClass,
        isActive ? 'is-active' : ''
      ].join(' ')}
    >
      {candidate.imageUrl ? (
        <img className="swipe-post-card__image" src={candidate.imageUrl} alt={candidate.caption} />
      ) : candidate.generationStatus === 'failed' ? (
        <div className="swipe-post-card__failure">
          <strong>Generation failed</strong>
          <p>{candidate.generationError || 'No real image was returned for this card.'}</p>
        </div>
      ) : (
        <>
          <div className="swipe-post-card__grain" />
          <div className="swipe-post-card__media">
            <span className="swipe-post-card__plane swipe-post-card__plane--one" />
            <span className="swipe-post-card__plane swipe-post-card__plane--two" />
            <span className="swipe-post-card__product swipe-post-card__product--one" />
            <span className="swipe-post-card__product swipe-post-card__product--two" />
          </div>
          <div className="swipe-post-card__copy">
            <span>{candidate.visual.label}</span>
            <strong>{candidate.visual.headline}</strong>
            <p>{candidate.visual.subline}</p>
          </div>
        </>
      )}
      {candidate.generationStatus === 'failed' ? (
        <div className="swipe-post-card__status swipe-post-card__status--failed">Real image unavailable</div>
      ) : null}
    </div>
  );
}
