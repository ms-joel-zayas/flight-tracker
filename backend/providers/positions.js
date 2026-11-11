export class PositionProvider {
  constructor({ providers, routeProvider }) {
    if (!Array.isArray(providers) || !providers.length) {
      throw new Error("At least one position provider is required");
    }
    this.providers = providers;
    this.routeProvider = routeProvider;
    this.name = providers[0].name;
  }

  async fetchAircraft(region) {
    const failures = [];

    for (const provider of this.providers) {
      try {
        const payload = await provider.fetchAircraft(region);
        return { ...payload, provider: provider.name };
      } catch (error) {
        failures.push({ provider, error });
      }
    }

    const combined = new Error(failures
      .map(({ provider, error }) => `${provider.name}: ${error.message}`)
      .join("; "));
    const retryDelays = failures
      .map(({ error }) => error.retryAfterMs)
      .filter(Number.isFinite);
    if (retryDelays.length) combined.retryAfterMs = Math.max(...retryDelays);
    throw combined;
  }

  fetchRoutes(aircraft) {
    return this.routeProvider.fetchRoutes(aircraft);
  }
}
