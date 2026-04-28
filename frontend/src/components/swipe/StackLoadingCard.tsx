type StackLoadingCardProps = {
  variant: 'initial' | 'tail';
};

export function StackLoadingCard({ variant }: StackLoadingCardProps) {
  return (
    <div className={`swipe-stack-loading swipe-stack-loading--${variant}`} role="status" aria-live="polite">
      <span className="swipe-stack-loading__bar" aria-hidden="true" />
      <strong>{variant === 'initial' ? 'Loading image' : 'Loading next'}</strong>
    </div>
  );
}
