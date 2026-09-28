export const NEW_PROJECT_TITLE_MAX = 120

export type NewProjectFieldErrors = { title?: string; seed?: string }

export function validateNewProjectInput(input: { title: string; seed: string }): NewProjectFieldErrors {
  const errors: NewProjectFieldErrors = {}
  if (!input.title.trim()) errors.title = '请填写小说名称。'
  else if (input.title.length > NEW_PROJECT_TITLE_MAX) errors.title = '小说名称不能超过 120 个字符。'
  if (!input.seed.trim()) errors.seed = '请写下最初的故事想法。'
  return errors
}
