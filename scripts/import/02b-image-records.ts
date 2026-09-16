/**
 * Creates the site_images rows the mirror then fills with bytes.
 *
 * This is the stage that was missing: 03-mirror-images.ts reads site_images and
 * would otherwise find an empty table and exit reporting success.
 *
 * Three things are worth knowing about the source data:
 *   1. An image can hang off more than one point — 43,373 links cover 39,358
 *      distinct images. Every row for the same photograph therefore shares one
 *      storage key, so the mirror fetches it from vici.org exactly once.
 *   2. Only about half the rows carry an attribution string, so credit falls
 *      back through creator, then source, then the collective credit. CC BY
 *      requires attribution; rendering 'Vici.org contributors' is honest,
 *      rendering nothing is not.
 *   3. Dimensions here come from vici's own columns and are provisional. The
 *      mirror re-encodes and overwrites them with the dimensions of the object
 *      it actually stored.
 *
 *   pnpm import:image-records
 */
import mysql from 'mysql2/promise'
import postgres from 'postgres'
import { resolveLicence } from './vici-licences'
import { requireDatabaseUrl } from '../../server/database/database-url'

const BATCH_SIZE = 500

/**
 * Photographs are not served from vici.org itself — that host answers any
 * /uploads/ path with a 200 carrying an HTML "404 - file not found" body, which
 * reaches an image pipeline as a corrupt file rather than as a missing one.
 * They live behind a transform service on images.vici.org, and originals are
 * not exposed there at all: /uploads/{file} is a genuine 404, and every byte
 * has to come through a /size/, /crop/ or /cover/ transform.
 */
const IMAGE_BASE_URL = process.env.VICI_IMAGE_BASE_URL ?? 'https://images.vici.org'

/** The mirror re-encodes to fit this box, so asking for more wastes his bandwidth. */
const MAX_SOURCE_WIDTH = 2400

/**
 * Width alone, because `size/w2400xh2400` returns exactly 2400×2400 and
 * distorts anything that is not square — a 3320×1868 helmet comes back
 * standing to attention. Capped at the recorded width so a small original is
 * never upscaled on the way out of his server.
 */
const buildSourceUrl = (path: string, width: number | null): string => {
  const requested = Math.min(MAX_SOURCE_WIDTH, width && width > 0 ? width : MAX_SOURCE_WIDTH)
  return `${IMAGE_BASE_URL}/size/w${requested}${path}`
}

const source = await mysql.createConnection(
  process.env.MYSQL_URL ?? 'mysql://root:root@127.0.0.1:3307/vici',
)

const target = postgres(requireDatabaseUrl())

interface ViciImageLink {
  imageId: number
  pointId: number
  path: string
  isDefault: number
  licenceId: number | null
  attribution: string | null
  creator: string | null
  sourceName: string | null
  isOwnWork: number
  title: string | null
  description: string | null
  width: number | null
  height: number | null
  capturedAt: Date | null
}

/**
 * Imported objects are keyed by the vici image id rather than by the
 * site_images id the application uses, because one photograph shared between
 * two sites must resolve to one object. It is still an id from a database and
 * never the uploaded filename, which is what the invariant protects against —
 * img_path holds strings like '/uploads/Villa_Rijkswijk-De_Bult.jpg'.
 */
const buildImportedStorageKey = (viciImageId: number): string => `vici/${viciImageId}.jpg`

/**
 * CC BY and CC BY-SA both require credit, and only 20,648 of 39,381 rows carry
 * an attribution string. Falling through to the creator and then the source
 * keeps a real name on the image wherever the dump has one.
 */
const buildAttribution = (link: ViciImageLink): string => {
  const credit =
    link.attribution?.trim() ||
    link.creator?.trim() ||
    link.sourceName?.trim() ||
    (link.isOwnWork === 1 ? 'A Vici.org contributor' : '')

  return credit ? `${credit} via Vici.org` : 'Vici.org contributors'
}

const buildCaption = (link: ViciImageLink): string | null =>
  link.title?.trim() || link.description?.trim() || null

const importImageRecords = async (): Promise<number> => {
  const [rows] = await source.query<mysql.RowDataPacket[]>(
    `SELECT l.pil_img           AS imageId,
            l.pil_pnt           AS pointId,
            i.img_path          AS path,
            l.pil_dflt          AS isDefault,
            d.imgd_license      AS licenceId,
            d.imgd_attribution  AS attribution,
            d.imgd_creator      AS creator,
            d.imgd_source       AS sourceName,
            d.imgd_ownwork      AS isOwnWork,
            d.imgd_title        AS title,
            d.imgd_description  AS description,
            d.imgd_width        AS width,
            d.imgd_height       AS height,
            d.imgd_date         AS capturedAt
     FROM pnt_img_lnk l
     JOIN images i ON i.img_id = l.pil_img
     JOIN points p ON p.pnt_id = l.pil_pnt
     LEFT JOIN img_data d ON d.imgd_imgid = l.pil_img
     WHERE p.pnt_visible = 1 AND p.pnt_hide = 0 AND i.img_hide = 0
       AND i.img_path IS NOT NULL AND i.img_path <> ''
     ORDER BY l.pil_pnt, l.pil_dflt DESC, l.pil_img`,
  )

  const links = rows as unknown as ViciImageLink[]
  const sortOrderByPoint = new Map<number, number>()
  let imported = 0

  for (let offset = 0; offset < links.length; offset += BATCH_SIZE) {
    const batch = links.slice(offset, offset + BATCH_SIZE)

    await target.begin(async (tx) => {
      for (const link of batch) {
        const storageKey = buildImportedStorageKey(link.imageId)
        const sortOrder = sortOrderByPoint.get(link.pointId) ?? 0
        sortOrderByPoint.set(link.pointId, sortOrder + 1)

        // Re-runnable without a unique index to lean on: the pair of site and
        // storage key is what makes a row a duplicate.
        const inserted = await tx`
          INSERT INTO site_images (
            site_id, storage_key, caption, licence, attribution, source_url,
            width, height, captured_at, status, sort_order
          )
          SELECT s.id, ${storageKey}, ${buildCaption(link)},
                 ${resolveLicence(link.licenceId)}, ${buildAttribution(link)},
                 ${buildSourceUrl(link.path, link.width)},
                 ${link.width ?? 0}, ${link.height ?? 0}, ${link.capturedAt},
                 'pending', ${sortOrder}
          FROM sites s
          WHERE s.source_ref = ${`vici.org#${link.pointId}`}
            AND NOT EXISTS (
              SELECT 1 FROM site_images existing
              WHERE existing.site_id = s.id AND existing.storage_key = ${storageKey}
            )
          RETURNING id
        `
        imported += inserted.length
      }
    })

    console.log(`· image records ${Math.min(offset + BATCH_SIZE, links.length)}/${links.length}`)
  }

  return imported
}

const main = async (): Promise<void> => {
  console.log('Creating image records from vici.org…\n')
  const imported = await importImageRecords()

  const [counts] = await target<{ objects: number; blocked: number }[]>`
    SELECT COUNT(DISTINCT storage_key)::int AS objects,
           COUNT(*) FILTER (WHERE licence IN ('UNKNOWN', 'ARR'))::int AS blocked
    FROM site_images
  `
  const objects = counts?.objects ?? 0
  const blocked = counts?.blocked ?? 0

  console.log(`\n${imported} image records created.`)
  console.log(`· ${objects} distinct objects to fetch — the mirror downloads each one once`)
  console.log(`· ${blocked} rows are ARR or unresolved and will never be published`)
  console.log('Next: pnpm import:images')

  await source.end()
  await target.end()
}

await main()
