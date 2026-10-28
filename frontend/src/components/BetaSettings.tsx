"use client"

import { Switch } from "./ui/switch"
import { FlaskConical, AlertCircle } from "lucide-react"
import { useConfig } from "@/contexts/ConfigContext"
import {
  BetaFeatureKey,
  BETA_FEATURE_NAMES,
  BETA_FEATURE_DESCRIPTIONS
} from "@/types/betaFeatures"

export function BetaSettings() {
  const { betaFeatures, toggleBetaFeature } = useConfig();

  // Define feature order for display (allows custom ordering)
  const featureOrder: BetaFeatureKey[] = ['importAndRetranscribe'];

  return (
    <div className="space-y-6">
      {/* Yellow Warning Banner */}
      <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-yellow-800">
          <p className="font-medium">实验功能</p>
          <p className="mt-1">
            这些功能仍在改进中；处理重要会议后请核对转写结果。
          </p>
        </div>
      </div>

      {/* Dynamic Feature Toggles - Automatically renders all features */}
      {featureOrder.map((featureKey) => (
        <div
          key={featureKey}
          className="bg-card rounded-lg border border-border p-6 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <FlaskConical className="h-5 w-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold text-foreground">
                  {BETA_FEATURE_NAMES[featureKey]}
                </h3>
                <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
                  实验
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {BETA_FEATURE_DESCRIPTIONS[featureKey]}
              </p>
            </div>

            <div className="ml-6">
              <Switch
                checked={betaFeatures[featureKey]}
                onCheckedChange={(checked) => toggleBetaFeature(featureKey, checked)}
              />
            </div>
          </div>
        </div>
      ))}

      {/* Info Box */}
      <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg">
        <p className="text-sm text-primary">
          <strong>提示：</strong> 关闭后会隐藏对应入口，已有会议不受影响。
        </p>
      </div>
    </div>
  );
}
