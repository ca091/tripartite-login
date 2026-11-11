export default defineEventHandler(async (event) => {
  const document = getRouterParam(event, 'document') || ''
  if (!/^(README|google|apple|github|microsoft)\.md$/.test(document)) throw createError({ statusCode: 404 })
  const content = await useStorage('assets:auth-docs').getItem<string>(document)
  if (!content) throw createError({ statusCode: 404 })
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return content
})
