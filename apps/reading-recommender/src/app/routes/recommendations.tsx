import { promoteRecommendation } from "@/features/recommendations/api/promote-recommendation";
import { randomizeRecommendation } from "@/features/recommendations/api/randomize-recommendation";
import { runRecommendation } from "@/features/recommendations/api/run-recommendation";
import { CurrentRecommendationView } from "@/features/recommendations/components/current-recommendation-view";

import { useAppData } from "../provider";

import type { JSX } from "react";

export function RecommendationsRoute(): JSX.Element {
  const { current, settings, loading, setCurrent } = useAppData();
  return (
    <CurrentRecommendationView
      current={current}
      settings={settings}
      loading={loading}
      onRun={() => runRecommendation().then(setCurrent)}
      onRandomize={() => randomizeRecommendation().then(setCurrent)}
      onPromote={(bookmeterUrl) => promoteRecommendation(bookmeterUrl).then(setCurrent)}
    />
  );
}
