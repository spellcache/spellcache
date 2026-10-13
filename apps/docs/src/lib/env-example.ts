// Lecture de .env.example, dont le format est fixé par sa propre légende :
// sections « # N. Titre » encadrées de lignes `# ===`, puis pour chaque
// variable un bloc de commentaires ouvert par « # [statut] », suivi d'une ou
// plusieurs lignes `NOM=` (commentées quand la variable est optionnelle).

export interface EnvEntry {
  names: string[]
  status: string
  description: string
  // Lignes en retrait du commentaire (`#   openssl rand …`) : exemples à
  // afficher tels quels.
  code: string[]
}

export interface EnvSection {
  title: string
  intro: string[]
  introCode: string[]
  entries: EnvEntry[]
}

const SECTION = /^#\s+\d+\.\s+(.+?)(?:\s+\(.*\))?$/
const RULE = /^#\s*={5,}/
const VARIABLE = /^#?\s?([A-Z][A-Z0-9_]*)=/
const STATUS = /^\[([^\]]+)\]\s*(.*)$/

export function parseEnvExample(source: string): EnvSection[] {
  const sections: EnvSection[] = []
  let section: EnvSection | undefined
  let comment: string[] = []
  let code: string[] = []
  // Dernière entrée lue : les lignes `NOM=` consécutives s'y regroupent.
  let last: EnvEntry | undefined

  const flushIntro = () => {
    if (section && comment.length > 0 && !STATUS.test(comment[0])) {
      section.intro.push(...comment)
      section.introCode.push(...code)
      comment = []
      code = []
    }
  }

  // Un titre de section suit toujours une ligne `# ===` : la légende en tête
  // du fichier (`#   1. Development — …`) a la même forme sans en être un.
  let afterRule = false

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trimEnd()

    if (RULE.test(line)) {
      afterRule = true
      continue
    }
    const heading = afterRule ? SECTION.exec(line) : null
    afterRule = false
    if (heading) {
      section = { title: heading[1], intro: [], introCode: [], entries: [] }
      sections.push(section)
      comment = []
      code = []
      last = undefined
      continue
    }
    if (!section) continue

    const variable = VARIABLE.exec(line)
    if (variable) {
      const status = STATUS.exec(comment[0] ?? '')
      if (status) {
        last = {
          names: [variable[1]],
          status: status[1],
          description: [status[2], ...comment.slice(1)].join(' ').trim(),
          code,
        }
        section.entries.push(last)
      } else if (last && comment.length === 0) {
        last.names.push(variable[1])
      }
      comment = []
      code = []
      continue
    }

    if (line === '') {
      flushIntro()
      last = undefined
      continue
    }
    if (line === '#') {
      flushIntro()
      continue
    }
    if (line.startsWith('#')) {
      const text = line.replace(/^#\s?/, '')
      if (/^\s{2,}\S/.test(text)) code.push(text.trim())
      else comment.push(text.trim())
    }
  }

  return sections
}
