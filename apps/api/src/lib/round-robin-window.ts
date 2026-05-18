import {
  canCampaignRunRoundRobinFailover,
  canRunRoundRobinFailover,
  type CampaignCallWindowConfig,
} from "./call-window.js";

export function evaluateRoundRobinFailoverWindow(params: {
  campaign: CampaignCallWindowConfig | null | undefined;
  now?: Date;
}) {
  if (params.campaign) {
    return canCampaignRunRoundRobinFailover(params.campaign, params.now);
  }
  return canRunRoundRobinFailover(params.now);
}
