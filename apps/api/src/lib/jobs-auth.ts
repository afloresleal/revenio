type ExtractJobAuthTokenParams = {
  authorizationHeader: string | undefined;
  queryKey: string | null | undefined;
};

type IsAuthorizedJobRequestParams = ExtractJobAuthTokenParams & {
  jobsApiKey: string | undefined;
};

export function extractJobAuthToken(params: ExtractJobAuthTokenParams): string | null {
  const authorizationHeader = params.authorizationHeader?.trim() ?? "";
  if (authorizationHeader.toLowerCase().startsWith("bearer ")) {
    const bearerToken = authorizationHeader.slice("bearer ".length).trim();
    if (bearerToken) return bearerToken;
  }

  const queryKey = params.queryKey?.trim() ?? "";
  if (queryKey) return queryKey;

  return null;
}

export function isAuthorizedJobRequest(params: IsAuthorizedJobRequestParams): boolean {
  const jobsApiKey = params.jobsApiKey?.trim() ?? "";
  if (!jobsApiKey) return true;
  return extractJobAuthToken(params) === jobsApiKey;
}
