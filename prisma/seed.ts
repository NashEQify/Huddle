import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { join } from 'path'

const prisma = new PrismaClient()

interface AvatarEntry {
  id: string
  label: string
  imageUrl: string
}

interface TitleEntry {
  title: string
}

interface QuoteEntry {
  text: string
  attribution: string
}

async function main() {
  const seedDir = join(__dirname, 'seed-data')

  // ── Load JSON files ──────────────────────────────────
  const avatars: AvatarEntry[] = JSON.parse(
    readFileSync(join(seedDir, 'avatars.json'), 'utf-8')
  )
  const titles: TitleEntry[] = JSON.parse(
    readFileSync(join(seedDir, 'titles.json'), 'utf-8')
  )
  const quotes: QuoteEntry[] = JSON.parse(
    readFileSync(join(seedDir, 'motd-quotes.json'), 'utf-8')
  )

  // ── BuiltInAvatar: upsert each (idempotent) ─────────
  for (const avatar of avatars) {
    await prisma.builtInAvatar.upsert({
      where: { id: avatar.id },
      update: { label: avatar.label, imageUrl: avatar.imageUrl },
      create: { id: avatar.id, label: avatar.label, imageUrl: avatar.imageUrl },
    })
  }
  console.log(`[seed] BuiltInAvatar: ${avatars.length} upserted`)

  // ── TitlePoolEntry: delete seed entries, then bulk insert ──
  const titlesDeleted = await prisma.titlePoolEntry.deleteMany({
    where: { source: 'seed' },
  })
  console.log(`[seed] TitlePoolEntry: ${titlesDeleted.count} old seed entries removed`)

  const titlesCreated = await prisma.titlePoolEntry.createMany({
    data: titles.map((t) => ({ title: t.title, source: 'seed' })),
  })
  console.log(`[seed] TitlePoolEntry: ${titlesCreated.count} seed entries created`)

  // ── MotdQuote: delete seed entries, then bulk insert ──
  const quotesDeleted = await prisma.motdQuote.deleteMany({
    where: { source: 'seed' },
  })
  console.log(`[seed] MotdQuote: ${quotesDeleted.count} old seed entries removed`)

  const quotesCreated = await prisma.motdQuote.createMany({
    data: quotes.map((q) => ({
      text: q.text,
      attribution: q.attribution,
      source: 'seed',
    })),
  })
  console.log(`[seed] MotdQuote: ${quotesCreated.count} seed entries created`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
