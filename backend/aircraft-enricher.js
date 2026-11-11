export class AircraftEnricher {
  constructor({ adsbDbProvider, airLabsEnricher }) {
    this.adsbDbProvider = adsbDbProvider;
    this.airLabsEnricher = airLabsEnricher;
  }

  get airLabsEnabled() {
    return Boolean(this.airLabsEnricher?.enabled);
  }

  async enrich(aircraft) {
    let enriched = aircraft;

    try {
      const details = await this.adsbDbProvider.fetchAircraftDetails(aircraft);
      if (details) {
        const route = details.route || aircraft.route;
        enriched = {
          ...aircraft,
          tailNumber: details.tailNumber || aircraft.tailNumber,
          aircraftType: details.aircraftType || aircraft.aircraftType,
          aircraftModel: details.aircraftModel || aircraft.aircraftModel,
          manufacturer: details.manufacturer || aircraft.manufacturer,
          operator: details.operator || aircraft.operator || route?.airline?.name,
          registeredOwner: details.registeredOwner || aircraft.registeredOwner,
          registeredCountry: details.registeredCountry || aircraft.registeredCountry,
          origin: route?.origin || aircraft.origin,
          destination: route?.destination || aircraft.destination,
          route,
          enrichment: {
            ...aircraft.enrichment,
            adsbDb: "available",
            cache: details.cache,
          },
        };
      } else {
        enriched = {
          ...aircraft,
          enrichment: { ...aircraft.enrichment, adsbDb: "no-match" },
        };
      }
    } catch (error) {
      enriched = {
        ...aircraft,
        enrichment: {
          ...aircraft.enrichment,
          adsbDb: "error",
          adsbDbMessage: error.message,
        },
      };
    }

    return this.airLabsEnricher.enrich(enriched);
  }
}
