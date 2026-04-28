import { useState } from 'react';

import { ExperimentDashboard } from './ExperimentDashboard';
import PreferenceSwipePrototype from './PreferenceSwipePrototype';

type AppView = 'experiments' | 'prototype';

export function App() {
  const [view, setView] = useState<AppView>('experiments');

  if (view === 'prototype') {
    return <PreferenceSwipePrototype onOpenExperiments={() => setView('experiments')} />;
  }

  return <ExperimentDashboard onOpenPrototype={() => setView('prototype')} />;
}
