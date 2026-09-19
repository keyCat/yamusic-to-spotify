type ProviderName = 'spotify' | 'yandex'

type ProviderBudget = {
  tail: Promise<void>
  nextRequestAt: number
}

type ProviderBudgetState = {
  providerBudgets?: Map<ProviderName, ProviderBudget>
}

const state = globalThis as typeof globalThis & ProviderBudgetState
state.providerBudgets ||= new Map()

function getBudget(provider: ProviderName) {
  let budget = state.providerBudgets!.get(provider)
  if (!budget) {
    budget = { tail: Promise.resolve(), nextRequestAt: 0 }
    state.providerBudgets!.set(provider, budget)
  }
  return budget
}

export async function providerFetch(provider: ProviderName, input: string | URL, init?: RequestInit) {
  const budget = getBudget(provider)
  const previous = budget.tail
  let release = () => {}
  budget.tail = new Promise<void>((resolve) => { release = resolve })
  await previous

  const delay = Math.max(0, budget.nextRequestAt - Date.now())
  if (delay) await new Promise(resolve => setTimeout(resolve, delay))
  try {
    return await fetch(input, init)
  } finally {
    budget.nextRequestAt = Date.now() + 100
    release()
  }
}
