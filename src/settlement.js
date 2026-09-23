const RESOLUTION_GRACE_SECONDS = 15;

export async function reconcileDuePositions({
  portfolio,
  nowSeconds,
  fetchResolution,
  onSettled = async () => {},
  onError = () => {},
}) {
  for (const position of portfolio.openPositions()) {
    if (!position.endTime || nowSeconds < position.endTime + RESOLUTION_GRACE_SECONDS) continue;

    let winningSide;
    try {
      winningSide = await fetchResolution(position.slug);
    } catch (error) {
      await onError(error, position);
      continue;
    }
    if (!winningSide) continue;

    const result = portfolio.settle(position.marketId, winningSide);
    if (result) await onSettled(result);
  }
}
