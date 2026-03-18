export interface CrmPushInput {
  first_name?: string | null;
  last_name?: string | null;
  linkedin_url: string;
  lead_source: string;
  comment_text?: string | null;
  source_post_url?: string | null;
  source_leader_name?: string | null;
  source_profile_url?: string | null;
  date_discovered: string;
}

export interface CrmPushConfig {
  endpoint?: string | null;
  apiKey?: string | null;
  authHeader?: string | null;
}

export async function pushLeadToCrm(payload: CrmPushInput, config: CrmPushConfig) {
  if (!config.endpoint) {
    return {
      ok: false,
      error: 'Missing Zapier webhook endpoint',
    };
  }

  const headers = new Headers({
    'content-type': 'application/json',
  });

  if (config.apiKey) {
    const authHeader = config.authHeader || 'Authorization';
    headers.set(authHeader, authHeader.toLowerCase() === 'authorization' ? `Bearer ${config.apiKey}` : config.apiKey);
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      ok: false,
      error: text || `CRM push failed with status ${response.status}`,
    };
  }

  const data = await response.json().catch(() => ({}));
  return {
    ok: true,
    crmRecordId: data?.id ?? data?.recordId ?? null,
  };
}
