export async function teamJsonRequest(url, options, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {...options, signal: controller.signal});
    const result = await response.json();
    if (!response.ok) throw Object.assign(Error(result.error || '请求失败'), {status: response.status});
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw Error('请求超时，请检查网络后重试。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
