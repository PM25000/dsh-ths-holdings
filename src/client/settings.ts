/** Save through the plugin host so DSH connection API changes cannot break settings. */
export async function saveSetting(kind: 'cookie' | 'fund-key', value: string): Promise<void> {
  const response = await fetch(`/api/stock-pnl/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
    redirect: 'error',
  })
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: string } | undefined
    throw new Error(body?.error ?? `保存失败 (HTTP ${response.status})`)
  }
}
