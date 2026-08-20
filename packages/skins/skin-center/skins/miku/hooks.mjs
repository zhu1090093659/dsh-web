/**
 * Hatsune Miku (miku) skin hooks — the trusted escape hatch of the v2
 * skin contract (x-org.linxin666.skin-center/v1alpha1), reviewed and
 * released with this repository. Loading this module executes nothing;
 * apply() owns every DOM write and registers its retraction through
 * ctx.onCleanup.
 *
 * Port of the v1 plugin effects (packages/skins/miku/src/client/index.ts):
 *  - window chrome: the fixed title bar (note icon + 01 badge + window
 *    glyphs) and status bar (waveform + status cells), mounted on
 *    document.body exactly as v1 did.
 *  - optional localStorage overrides (dsh.miku.title / dsh.miku.cells):
 *    pure presentation state the skin reads itself, with the same bounds
 *    and the same fail-safe degradation as v1. v2 has no storage facet;
 *    the skin remains the explicit owner of these two keys.
 *  - favicon (inline teal-note SVG data URI) and the pinned document
 *    title (restored on dispose only when the skin's own title still
 *    stands).
 *  - custom Miku cursors: a scoped style block (MIKU_CURSOR_CSS, generated)
 *    injected into document.head and retracted on dispose.
 *  - right-panel collapse handling: a lightweight poll toggles the
 *    body[data-dsh-aionui-collapsed] flag so skin.css can keep the floating
 *    collapse/expand buttons from overlapping.
 * The v1 backdrop (idol art + theme scrim) is declarative in v2: it rides
 * contributes.backgroundMedia in skin.json, owned by the skin-center. The
 * class names are the css-modules hashes the compiled patches.css carries.
 */

/** The product title the skin pins (captured by the shell's DocumentTitle after settle). */
const SKIN_TITLE = '初音未来 · DeepSeek 在线'

/** Status bar cells; the spacer cell splits left and right groups. */
const STATUS_CELLS = ['MIKU 01', '声库就绪', '已连接', '在线', 'VOCALOID 正式版']

/** Title bar window buttons (decorative glyphs, aria-hidden). */
const TITLEBAR_GLYPHS = ['–', '□', '×']

/** localStorage keys for the optional title / status-cell overrides. */
const LS_TITLE = 'dsh.miku.title'
const LS_CELLS = 'dsh.miku.cells'

/** Bounds for localStorage overrides: keep the injected chrome small and
 *  bounded so a large or hostile override cannot stall apply(). */
const MAX_CELLS = 20
const MAX_CELL_LENGTH = 64
const MAX_TITLE_LENGTH = 200

/** Miku note mark (a single eighth note), inline so the skin carries no static assets.
 *  White fill: the title bar wears the blue-violet-magenta gradient, so the icon
 *  must be light to read against it (matches the white title text). */
const NOTE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">',
  '<path d="M32 8v20.6a8 8 0 1 1-4-6.9V13.4L20 16.8v17.8a8 8 0 1 1-4-6.9V12.2c0-.9.6-1.7 1.5-1.9l16-4.4c1-.3 2 .3 2.5 1.1.3.5.5 1 .5 1.5z" fill="#fff"/>',
  '<ellipse cx="24" cy="44" rx="7.5" ry="2.4" fill="rgba(255,255,255,0.45)"/>',
  '</svg>',
].join('')

/** Miku "01" badge: the iconic unit number on a rounded teal chip. The
 *  outline and number are white so the badge reads on the gradient band;
 *  the chip tint is a translucent teal over the bar. */
const BADGE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="18" viewBox="0 0 68 36" aria-hidden="true">',
  '<rect x="1" y="1" width="66" height="34" rx="8" fill="rgba(57,197,187,0.16)" stroke="#fff" stroke-width="2"/>',
  '<text x="34" y="25" text-anchor="middle" font-family="Consolas, monospace" font-size="19" font-weight="700" fill="#fff">01</text>',
  '</svg>',
].join('')

/** Favicon: teal rounded square with a white eighth note. */
const FAVICON_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">',
  '<rect x="2" y="2" width="60" height="60" rx="14" fill="#2e9bff"/>',
  '<path d="M42 14v24.6a10 10 0 1 1-5-8.7V20.6l-15 4.1v21.7a10 10 0 1 1-5-8.7V15.4c0-1 .7-2 1.7-2.2l19-5.2c1.2-.3 2.4.4 2.9 1.4.3.6.4 1.1.4 1.6z" fill="#fff"/>',
  '</svg>',
].join('')

/** Compiled css-modules class names (see patches.css). */
const CLS = {
  mikuTitlebar: 'NPtzYa_mikuTitlebar',
  mikuTitlebarIcon: 'NPtzYa_mikuTitlebarIcon',
  mikuTitlebarBadge: 'NPtzYa_mikuTitlebarBadge',
  mikuTitlebarTitle: 'NPtzYa_mikuTitlebarTitle',
  mikuTitlebarBtn: 'NPtzYa_mikuTitlebarBtn',
  mikuStatusbar: 'NPtzYa_mikuStatusbar',
  mikuStatusbarWave: 'NPtzYa_mikuStatusbarWave',
  mikuStatusbarSpacer: 'NPtzYa_mikuStatusbarSpacer',
  mikuStatusbarCell: 'NPtzYa_mikuStatusbarCell',
}

/** Read one optional localStorage override; returns undefined when storage
 *  is unavailable (private mode, file://, sandboxed iframe) or the key is
 *  absent. Never throws. */
function readOverride(key) {
  try {
    return window.localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

/** Resolve the pinned title: localStorage dsh.miku.title wins when it is
 *  non-blank and within the length bound, else the default. */
function resolveTitle() {
  const override = readOverride(LS_TITLE)?.trim()
  if (override && override.length <= MAX_TITLE_LENGTH) return override
  return SKIN_TITLE
}

/** Resolve the status cells: localStorage dsh.miku.cells (JSON string
 *  array) wins when it parses to a bounded array of trimmed, non-blank
 *  strings, else the defaults. */
function resolveCells() {
  const raw = readOverride(LS_CELLS)
  if (raw !== undefined) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.length <= MAX_CELLS) {
        const cells = []
        for (const cell of parsed) {
          if (typeof cell !== 'string') return STATUS_CELLS
          const trimmed = cell.trim()
          if (trimmed === '' || trimmed.length > MAX_CELL_LENGTH) return STATUS_CELLS
          cells.push(trimmed)
        }
        if (cells.length > 0) return cells
      }
    } catch {
      // Fall through to the defaults on malformed JSON.
    }
  }
  return STATUS_CELLS
}

/**
 * Miku cursor surface: inline PNG cursors extracted from the user's
 * Miku cursor theme (art by Moos柚眠). Maps the standard cursor states to
 * the theme's pointer shapes. Generated, do not edit by hand.
 */
const MIKU_CURSOR_CSS = "/* Miku cursor surface: inline PNG cursors extracted from the user's\n   Miku cursor theme (art by Moos柚眠). Maps the standard cursor states to\n   the theme's pointer shapes. Generated, do not edit. */\nhtml[data-dsh-skin=\"miku\"], html[data-dsh-skin=\"miku\"] * { cursor: url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAEl0lEQVR4nN2YXUwTWRTHeffJFx/0VWOi0WRNVHQhWY0KfkaIikAjUfAj1sjWT8CiFRVXNAVhi+KSroUYyWoUpaXbFkEgavxCEb8QE40SY41GWR9MNsox59Y73rm9U9rOdLCS/MOd6bn3/H9nztyZNiExeRFQJcTjHxpfnLYKCgr3xScIGkbznwYG4h8A5XZ54wuCB7h9/VZ8tRMPQBX3AHHTTqEAYtFO7LatybqhAGLRTroB2DvfymSudqtOhvNTNppgXadXJlUgPMC7tx+g98V7YpjV2sKqqJNQg2g+/eAhyfhq5znIqLZpC4DmseKiS60WgK88NR+VcRFANK2iBCk6z5oOVZyICocfbt5WIrWN0VIbNgCbIC8pG5YnrZCOf01bA8mrTKRtqBDAcKpOOp6zzkRiUEmZm4JM82sKfeHJrI17ZW0TTfVbZhRBxUyjdEzMn2wJahtWBrePxKBm7zkWBMCvqQigxjhWCRMp7TCRil+TFkIzALY9cIyXGKvE7zBaA+D6c3ON2tz0fFVEO4zWAJruWrRVtGobVvz9wK6vCkD0MIoFQNpZHyysrJd2p4WWsu83/bcdLKpnkqhVYgHA704IJGozVQD0UoZqA1HicGMoQOJuJ6TYmmMLkNsWSBgpwP7GdtjZ1BY0V3cAmixSAOi+AR3tV4QPu2EDoONwzGEMlaJRPQByfIGdI+Psv7Co5jQkbjkATVVWKPvjMBmjYYyhybOcXpht80BjeZmkiSvNMHV9MSwotcjidQFgqzU5ew+MHjVKJr6dEBRjR44YIRQbrysAms1IXwF3bzyC8ZYjkP/PRYBBIC1yydVJzLBiY3CcU3OKzEWISalz9QeYMCUR1htN8LyvH6ZV2qGwuVUC6Gm7AkUnfDKxMTjOP+Mic8dO/AWmZ+WQVtIVYIHRDKW1DcTQcncHWO88lABEYmPYMa4zv/ioPrsQ268swFb/HUmDb14Kxcag6j480w+AvpPgSxe+t+DlJgDH62HwvwFw9HeD49U9cPgfKgLgZ5L6u+Hy6z4yVxcAdiH6uksAKmrgS+/9gJ71KprnJc3pvT/MADa70OD/fT3wsaUpLBhdAbCN5pmKSSthUlOVAzoutweZ+vz8MXy62RnS+Junj8lcYr64KvCdINYA/A2daj1NKhhu67BC8zhX9oVGTwBWaIRVSamVtBAvn8MhxcwxyH9WSeC+/ekOkJK3nZgqsNXBn/YGuH3hIpxpdUOzx0XG/pvXwNvoBMMuK4mbtSxveAGU4h+8fg+eridg+esCjGlvhWSnl4zZ80qGYgbAvkKLAPB4qWEzMYeqdV0lhscUFULm3yfJmH6G+tLhAZ/COhRA9pKnFQD+X1peLbvkVKnpa2CDuZyYP3+1JwBQWQGZ5xrJGM8frnOSGDRfUWAeEmBJQyCnZgDsjsEDsC1EhS2U2dUlHTvOe4LiQwFQRQzAPrB4sb/hFO2wAPj9MuH5TTtKggBCxbMFGSqvKgBc5Lf8/UMCZOf+Tqo9znYcltjrpcqHA4C/WmOemADwyUIZEmkoALYtVQOIFE5cpOuq9fBzAvzIf18Br0uWC8Eo27EAAAAASUVORK5CYII=\") 2 2, auto; }\nhtml[data-dsh-skin=\"miku\"] a, html[data-dsh-skin=\"miku\"] button, html[data-dsh-skin=\"miku\"] [role='button'],\nhtml[data-dsh-skin=\"miku\"] [role='link'], html[data-dsh-skin=\"miku\"] [role='menuitem'], html[data-dsh-skin=\"miku\"] [role='option'],\nhtml[data-dsh-skin=\"miku\"] [role='tab'], html[data-dsh-skin=\"miku\"] [role='checkbox'], html[data-dsh-skin=\"miku\"] [role='radio'],\nhtml[data-dsh-skin=\"miku\"] [role='switch'], html[data-dsh-skin=\"miku\"] [role='treeitem'], html[data-dsh-skin=\"miku\"] [role='gridcell'],\nhtml[data-dsh-skin=\"miku\"] input[type='submit'], html[data-dsh-skin=\"miku\"] input[type='button'],\nhtml[data-dsh-skin=\"miku\"] input[type='reset'], html[data-dsh-skin=\"miku\"] input[type='file'],\nhtml[data-dsh-skin=\"miku\"] label, html[data-dsh-skin=\"miku\"] select, html[data-dsh-skin=\"miku\"] summary,\nhtml[data-dsh-skin=\"miku\"] [class$='_entry'] { cursor: url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAEhElEQVR4nNWZSUwUWRjHvXuaCwe5jZpJ9DLjqV1aEA3tQpAlBFrRVtSOCi7tBnZk0cFl0CBoGncFg2M04tCBFqFZBNxiIomKGjSGZCYx6sWDh8lMxM98H3nlq9dV1VVUdWl18k+qX1699/999dX3XlVNcrkzgGmSE39o3J1RAJ7NAWeCoGE07x/scj4AKr8h5CwIEaDwymVnpZMIwOR4AMekkxaAI9JJC8AR6aQG4Gnslimt8pQlEPzCaUlgRIB1fV1Q2BElw7xSNlWYngzPX1BQRPPxMgUSU0Y7ohRxpUhZAWB5xeMHtTJVxDlQCalyOMAif0BKm9Rt1YYGVbtKSu1oem37TTKOythbrnh1DV152sytDsjSxmgAjACwqGuZNAww0Rzkz+2eHYS6OcXSfxYUrfLM7jc+dbXGVPQ4EQD+HI87G9bPW0kTlS3dIlWWZVU1kH0jqgngi3ZRH1Rmw7dFkx9zV/oWCoalaxEPgBNhpPQsiHokjmkmvVXNi4MqVRirASytWqlFAbrsLu5pzioANOzN2SblPpvLUgD+Cc5K8+JaJI5vCkApVRIBIFYnpUIwoftBaTFC8zmH/1A0gBUmnkm1PgwgLdQJmc3K94kpAHYptdIgXgnV6iPtxyrawRO6lVgANplRAHjyCAb67ykudt8NgG3Fq1v7obStj47FyVkfBHhx/wH1zb9xGwrbO6U+bIGzHYAd64ku9mFSNWoHAD9Z8GxUZgwlphNGG/uK/Xoig+OGuf62Aswva4IN+89B28lamTBFdv/VS8ZRGRc6yFjr8RqZfi8/CDML9sHi2quQ09hiP8DS4n0wZ/kKmJKUJBMfXV4/TZ6sKBwn90i9/QCicR5ASWoAqKnudHuqEL8YzZjlgvkpaeDPzxuXNx/8q1YAjDxV1Jq83G/KypQ0beZv8GuOzx4A/obDS3+o7gyMjQyPa3QEvnz4R5ekc0aGaZwl5fWJBeAHYttdAghd1G1aTT8kwNjbUfj85sW4/n7lPAA0/u/dKOm/Jw9/HADxfsAajgbQSORKM/w85RdSsc8fN3UG7vTTubLnATsBcNKFO4/AosISMt9wtBa8BUWksh1l1Pb/62cyvXv6mIyjTl9spnP5d1OujfXgOXzJHgBeGHU0/uD5S1LdqfPU9qm7TaZoUxNFHYXmxTckag9MCQHg+6oBJPf3gru9C6rOheH5u4/QOfSKjtUMJQyAbYm1ALKyvNDS00vmK6uPwmrfZki+dhXSW8JwPnKfzP/Z85gAgpu2w/Z1xTHj8AD8omkagN9CqwGkpC6B4LFjFHk0jxFPDu4F76VGOkbjTGMDnRBVGMclvHiWdqlWAai9EjxxOQy7qo7HtGMKeYeGCIAXQlyP3AV4/171HuA/thgGwM5zs4uo5qP5vNZYgGBphSQ0v6e8RtaGmh46Db5wxBAAe3POA6CPed4S/RD8gqX26Ymv6QxIrPXYXrLngCGAePOaAuDTQy+AXompaxpgbu6GmO9m/ITdrWFJ+D+wtVTWxtonCmDqm128ScQ+aufomsygh6836z4JEdiKrAAAAABJRU5ErkJggg==\") 2 2, pointer; }\nhtml[data-dsh-skin=\"miku\"] input:not([type='checkbox']):not([type='radio']):not([type='submit']):not([type='button']):not([type='reset']):not([type='file']),\nhtml[data-dsh-skin=\"miku\"] textarea, html[data-dsh-skin=\"miku\"] [contenteditable='true'],\nhtml[data-dsh-skin=\"miku\"] [role='textbox'], html[data-dsh-skin=\"miku\"] [role='searchbox'] { cursor: url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAC1ElEQVR4nO2YW2sTURDH+z38IkGIQlTWSKgUWxtqTJtGTU1qYSEpNKRKRIWC1F5oY0BFi8G0jZRWTU1WC23QInihD9UXfakvffNB8KXYkTlylpPN2XWTNtmcugN/2CznMr+Zc5lNi8PpAbNqaUZDx5weL0hhWVdND4BOXioVddX0AKwGh2/Cz91fYi0hoQFY4wFY7VNVZgNYbTaA1WYDWG02gNVmA1hhwtdCBwJA+O8B17kL0Dk9paumBxD6m/i/s1oy01TZFBaATqw9oegmN+rnbg1CRB6z7mTDidqPtELo6Gnoy+agd+axekJ5hob/ufnPuH0wEkiQvqHFRQKAR/eJYKQxEDgJOv/W1U4i2dUzZPrk0va9fPuB6eztKwArp18G6eErw8uPt8wsBTh80ksc9yeuQmAiBX0r70wD+DIzZMlg5vzJOxXv674f2KjP7mypMgvAblxe2VI3ADowOt6WU8hkWoDE5/WqYOiyaSgAOu999hdgcntTFf6OfSqpz7UC1O1E0jv79yIeQF02tJkyey/Sjt8wAN+yAt2KwADshhYSwBF9DtJonvs+PpqH32uFCkjMmvbiazhAoFiAztmXxMmBVJ486wHcmFcgNldU23QtFcE1XrAWAJ1BJ9FBJbtMnvUAtG1oX8sAMP0YVeocFTrFigXgtTEDsG/fDtgRLxccGAEG7i+AMj1FtJHNwO6HNxBPr5Zp7O6S2obK0TuuSvtHAQ+gf/A6dIeicNx9luiY1FE7EFtKuK6l1AHi0QTA1tcKvZ7PVVVm8wA2t3/AU6UE5wNhoraOntoAyibCJZRf5zqtJwrDvst8/AYvvnwnThoVdhh5CiAlb8Gh1ZWycQxB2ChTYfSvpOdg7f2GaeefpO9VZIoFwKVyMTlCIl92z4RlOBWMkMjrAeC4cn+MD0EBtMS0nDYDoLfMWADUo4WCYV2kB8Bm2HDpiKCDByCa/QHLa9AS3K0rIgAAAABJRU5ErkJggg==\") 4 5, text; }\nhtml[data-dsh-skin=\"miku\"] [class*='loading'], html[data-dsh-skin=\"miku\"] [class*='spinner'],\nhtml[data-dsh-skin=\"miku\"] [class*='pending'], html[data-dsh-skin=\"miku\"] [aria-busy='true'] { cursor: url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAFGklEQVR4nM2Y709bVRjHeb9XvtkLSfwDZmKir3AM3a/QaRbGD5dR6EYFrE5wG06ZlG6QbY7pC1aEbpItGxgcqDCK0LG2wEZxVJF1P7AoA6MRTUCNe7EXJku2xzwPOddzT++9vZf2tjT5pveePuee7+e5zznn9mZkGPzAo3+ByWjftH5446LS7U3XR8nsmgRQy64egLTfGa0SiQeA38t//A7zP/1I+vXnhdRDaGVdDwAab209Rxr2DacfQGxXA0Ax42sCQMuoqIcP/pZlnpn/LhxO7zxQaxclmketidUpXv2LcXrLJitnJ4gyFSDessh+Q/O3p6c1Nzs0u6W4HCxv18hkGoiRUtCaJzwAGnZMBGQy9U7o/aDJmTu3ob6+IUbdn3cThGh8z1lP+o2z7OkFeH3oChlH7aw7qjgXUjZPVgPAsq5lMmUA/ABa9T+9tBhTPijbcBAsHSOkrQ3nYkyPvOgE98aq5IPwF8wrLAOn60P49psJuD8blQzz+nI+qghQFgxAQW+QlHf2M2lFsuQUQOWmUjL/Xu47kLMvySsVD4Dm0bTVagP3GbfiZDUivCaax+zjMZrHO5Q0ALE8MPNonpdW2awWIOFVixkeC/gl4TmWDWaeB0Coa1NhaI9GDAOgYWvhQan2N5fXUIklDSA7+yVJ/J0Q78Jqy0mc0PzGZwoAKxWxnBKZD/zqxLKf8M4dDwC/sWzQOKqr9yvNeYAmcRXSAtjq8UNel/I8SToACms+3trPl4pSdnmArGNDYPFcNRcgtLAorRJ6zDHB3SkIjd+M6WsawGhwDFCuepckzHLHnVnJRMX1lcFPesfhyOB1OhYHZzEIMDsZptg9vdfANuSXYtgGl1QApUcGPlv8sZ7sYgyTqlEzAPjlTBzsudIGeHr9epLjtUIyJ5YTZhtjn1q3TqZnnt+2YpiLTykAmt+yrxYcFZWkxsPvwmBrM5XI+/1jZBy1w90Fzxa7wG6zybSr9E1q39HcDYUdfakHoKxXVAI8AdLgwAC14V0Y9U2QGRSaxIyzOCZv3xVqf7XKBUWnW9YWAC/vmY/jArxytCX5q5ASAL8ZbXghC4ptdjKOave0gWNvCcDcPZmm+nrAvruIDDOlDYCfcDjwxl0l/0/ivSXw5M9FVfETOOUA/IXY4y4OfMrdDo/nfljRL3OS2eWAD25YraToR02KMPb8POqXXoBPzpNxMv/bgiJApO4DOucBsKTaTjRSv/QCeC4qlgsPwKRWWikFEOcDruFoQA3gr6YTksSY0I1x6iv7P5BKABx02+HTsN1WTWZ4hXt64K7zCPzT3irp0fwMLN27JcV8erGL+uJ1Nh88uWLyrRawNF1KDQAvzCSv46ea4eHIYIyCnZ1SDJoXX5+I/8hMBVCLjy49AH/kPjSeH4DM8THIGQrQMd+uZsg0APZIrAaA57n5dsi3HSCT/ZMzcME3CZlfdENu3wAdY/vl0VsE4Nx/CA5VVClehwHwm2bCAPwjtBoAmkdzKDSMGc901oH1Ugcds99Qj0N+CKpchwHInlKTBcCvGBkq7zTRLBOWkDUSkc47+/2a70BFACbDABicXVBOaz6a3+1VfqdpL6sCZ22jTGjy69D3MQDY3nbhcky8OIm3O2pkCUOhj03Wav0Q/IYligdAA7C8LBO2V9cejwHQiucB4o2bEIA4mJYhJcUD4MsyYYDsojeoEy8RoOZAHYx6fTJpAWjFiwDi2C/vP2YMQEl64oxe16iH/wCTcJqxbfGCmwAAAABJRU5ErkJggg==\") 13 5, wait; }\nhtml[data-dsh-skin=\"miku\"] [data-dsh-miku-busy] *, html[data-dsh-skin=\"miku\"] [class*='busy'] { cursor: url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAFaklEQVR4nO2Ya0wcVRTH+WjCJ2NCGj+YaKLGV1OpIq/lDQuU15a2QHeFliIICyX4oC2lsNGKjZK2gIC1UETbqA3SWh4tBXlGkCooBbS0SSU2aNUPapuqMZZjziH3end2ZplhhwWTTvJPZmfP3PP/nTn33tn18Lhz3Dn0O7wfD4GlaKV98wPNPP1kDAQGmiF2i1VRkfHZFLMqAdBYkrkKSj4aVFT+oTMUsyoBMnKLoev7a6q0FABfQxxIpStA2rZCqDzxMRnsm5uDL3/5yU54/eT4BMVoBUCzoamZYMwrspOuIMwUGkXDN+f/sBNeZ+a1jo0m0XD20Hk76f4kPCTthMZnb/3mcttIjafU1epvXARg7YQAE7NXZdtGqaflrqPp7e2tZBwVt2ef7FzQbZ4wswjQdq5LtvJaAVjVnZnUBUBNC4kJevxK4LC/lX82pBeB8d0eh7YRZTnbTTGosPJ6B9PSMVWBMINo/tW3GvlE/uGvG3SO17G1MIYmpcEEWYFmSrQ7toCvLBtsb4CppdspQEb3eYpBJdS9x1ckccyXogqoGJoB1KxCOCAmwkoprTBaJR2TPUlVAEvZyJ7yjpBdYfQGULVqoaHkrQVQ1/E5HP/qkqKahicpBuP9QpN0qTwTGk7bWMh7PySziLeiKgCt70Lh6bm6mUdJJ7RYHFUAWqU3gHR1klsIFOeDM6Pr14ZRv6PhoEQLP0+07Zc1gCvMYiaVYhhAWG0XJByXnyea9wa5zchZGyy2hDqLYQC+Ze1grO1cXgCWTCsATFyAwYHPZDe7FQPY0bfwef/pAdjV1kfn0uQsBgG+GR6h2JSWc2Bp7+IxbINzOwA7V1NdjGFSNOoOADHZWnM53OvlZSdpO2G1MfZuT09ZrRgAmg9MfQFSNm6B+/wM4GOMhewdWdQiL5/qJeOouMazZGyNtw+sCwmHbRYLnT/mHwSmDYkQW2GD5Hdq3A+A1UbzX1/4Fh62VULhyTMA80At8mnHEJkRJcbgecaRE3QvPoUnoiPdDxBrLYWKhg/JkKV3lGv+52uyEmNQ1ZNX6F4cJ2ZflXtWIXEzIoC334f5G79D9cgYVI+OQ/XYRQfjt+euwt9XJuk7rpEx6JyeoXsrao9BUU0zRB/8YPkBxAlKAIePwO2ZqQV9NyNbeTR/s6fNHordMzNFnwf7B2i8ZQMQB2KvuwRQe8ypaVFKrbUqAf6ZvQR/fjFEujXc+/8DWKyFVgxAOh9w4mHixSCcCe9HUU53AuCPkPAXD0CEJZ8qKGp6dIQqL9X1i2MOsXYAz1eB8fUm9wCIYiaYXqk46DCJUd3NzQ6x0py6/RWpBJBWXw3BwaF2EuOnr/8KXeOXwXb0E4e4xbRsAOyVGM2nHNgLydZ42BUQzoXJY0wWSLLsJPNNbf2QV1ppF6MkHMuYkwjr0jeBf1A0xOTt5G+xbNN0GYC9EqNRTLh3KAt+XB/Fhdc3p2dT1VFoHq+JMUrCsVI7rXBPYwndE2dd+M0tbprLAtByVwb0e6VwI6eeieCtgJWVGjV4ZkPxGrMmACbNABgcYMqkNR/Nbz79H0CcJQZy6lOhIWo7dISkciODPpG8LRp8IxyMovmj92/isEw4VtKhZ+GBshwwBEWCMSff7l8KFPoITMtXDyFuWKLECYeVa6rZqqpNpHI2ieXyiv8dLQkgwlZDCWBuDvpaWznAm69lUis5a5XWh0x0TWwzHEcUG1NsXZcBApKfo5tQoXklPPFU/wCUF++mR7+n1EytNPlgAlx+JM6hVVADj8ZzIC0ALDdTcG6ZNgBRuLxJEzub0EpSA6DkYUkrkfRQ6l2E0CK5MVwy5ioAtpMWrRiAVjAluZLrX+Rapyjzg9W7AAAAAElFTkSuQmCC\") 8 5, progress; }\nhtml[data-dsh-skin=\"miku\"] [class*='help'] { cursor: url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAE3UlEQVR4nN2YX0xbVRzHed+TL3uQxBdNfFhi9GXZHI1zLtQhmaELQjOyKkzmhIXhcHMNMCJMEBcoRdA5GFDJqkuZrYMhtDALimZmbE7s1mkyoy/Dl5n4sGjcfub3w3M89/Tc23+XS7XJN7m3+Z1zvp/f/Z3fuW1envQp3bgD9CTH5twHTe57fg80uGoTVOfcl/sQaBDNhkKhBHk7unIXgJWIyrisnCsnsWxSAci5cjIqGz3lVDn97wACgQD4fD6NYbz3+/3/DQA029baqgHA+16vNzcB8qQulAwg2y60yVYMskwDwMz2vuMhswjChPe93T0885kCoNmnyyvB/mq9RqaCsHLCrDOZVTZoEg1Xz09rlPMAzKBsvKy/zxzjIgAeUmjW2z/0rzq6oLWhSQmgV9Oq79H0S+PnyDiq+GiTci9ktU9YjY9FYlxGdZ8uAMu6kUlTABrbP+DSAxAXiGx2g+fJGn5v21MP9uFIQtmIqpgMUwxq27H3EkzLc6YEwsyeOHmOSwYQJ7TbSmBvwW5a6I2iA7yzPNfSCSWBsCGAKzxNMaid/T7ekcQ5GwoPUDLSBjAqIREAF8JM6XWYdCXPyZ5kxqUkl45qUlWHMRsg7a5lBLC1sp4eOy1QXG5K5pnQsNNRx2ufrWVa2xVLxayyESVvaHH+rABUpbIaAHJ3UjWCjE5u1WGE5h3tbysNYIdJZlIvhgFs65uCnaPqfZIVAHuURmWQrIUaxTCATc3jYO+7sLoAbLF0AeDbSzAX/VJ52K0ZQNXFlfu2YBSOnL9I1/LiLAYBYgtfUWxZ4DOoGJ/iMeyAsxyAXaeSXYxh0jVqBYC42GO7j8GD69drJJcTZhtjRQDUzMT8imEh3lIANF9Q/hqUOV6AhzbbYKO9CKqr9lKJvP7JLBlHFQ9OkrFgd6dGrU3HYUN5Izzb5QfH8Jj1AJhtNH/10nV4tOUE1J39FOA+aLIr6oF165QqqmmEXR091gPgwm8NfESmSyfnoOtKjAOoJMaI1wjxsK3Qmi4kHkYigOvrBTh+fQmu3r0DEL+mlBiD1+/ejNPYRzY8AY87XNYAiBtOBDi0fIXr/q+/KCXGoHy/3aKxOM+Opp7VBRAnYq+7BOA5CffiSyu6Fedm//zhO/g9cp5095v5BBg+Jr60xgDeU2SczP/8Izf41083yDjqj9hiIsA/Y1BrC9B3WrdkUpWlAPJ+wB6OBtBIJBjiC7mPNCc1Pvd5lMZqfg9YCYCLPnOoA7ZX1JL5M4Mj4D7cQvJ0eug73Auibl+7TMZR758epbE4z9a6thWTr/SAvX3IGgBZaByWl0kzwQn6jm1kpvDICGUdhebF8Xlm/xWZDECOVQHkR2fBNj4NLadC8P3tOzC1eJOu9QytGgB7JZYBxOz7Bz/k5n0Do1B7+E3I/9gPhWMhGJhYIPNnZi4TgHv/QThYVaNMBAMQD82sAcRXaBUAyzwK79E8ZjzffRScQ8N0jcaZ7s1NQVjnSTIAzVuqWQBix0gJIDoLzsVFuhaFEGcnvuDxqj3A1svoTy4M3lJSST0fzZcG1f9pvuiq4bW/HLtB5YPmuwf8GQNsr67XJAyFPgqctalDiAeWLBFAtXFFo5kAJFs3KwB5MTMll27WAFt2vUyDRFkJIK/91P7m9ACMFrHio+fhb7ymK1sfnZv9AAAAAElFTkSuQmCC\") 11 7, help; }\nhtml[data-dsh-skin=\"miku\"] :disabled, html[data-dsh-skin=\"miku\"] [aria-disabled='true'] { cursor: url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAEx0lEQVR4nNWYXWwUVRTH+86Tz33UN/w2FipsXRF326UWdhtsJxZaSgFxy8eqQLuhpeHDUh7ABlsRQVqjFBNKi+wKu9sCLVqipk0oQQUTE8IL9UWTJj4Y9ZhzmzO5c+fe2Y+ZHYdN/snM7Jlz/78z5947uyUl3Of5J/2QTSVe/JC5XZFN8E5oHbSW1yjlSRAy9fenF2D+0Am4XxtVynMAVHk0LzOKEiGGAuu8A4FGsG3EymO7aC+GmFE0nA5t8C4AmpW1CxkVYzwLgMfrn/FBsqzMsp08DbD66QroeaEcZqs0+On1RlM7eR6AhE/hG3+lqW08DSD2vayd7AIs9VWDKNsAW8oqWcugOVxtaMOiduLNY9xpf7ggADT7Sn0zBN+OGWQLJNeJS8I4hCoUAA1vvpE2yPaTUPW9WHn8vpCdmAyKxuv6++y3EA+AlT1e/hrrcVHYNlR5HkDV07LraHpD4gIzjqpu75DOhYLnSSFvo/kCUNWtTDo+0VUffoCx8jh88FJUP/etj0FwYMzUNrwaLmdYDGrFvo9MpsWcjoHwCYO+MLQsf5MN1Bbapq8sq7qOQPh8xhKgMZNmMaia/s/0FYnP+V5gGytG0QBwIKyUaoXJV2JOepKOAciSylYYpwEcW7Uwgb85xh47G6C63pHKk9CwFtmh9z6N5SgAGXaqbXiJE5rPbwtA1irFABBXJ9lCUNB8kG1GaD7S3SM1gCtMNpOqGAJY0ZeCms/l88QWAD1KqzbItoRaxRDA0s4EBPu+Li4ADZYvANz6HiYnvpVudv8bwMZrC+cHRydgz6Vr7FgcnGIQ4Mepmyy27vwVaEik9Bja4FwHoONcqosxJKVRNwD4weInMwZjKLGdsNoYK8aNJ28sGObiXQWoaBuEln0nYfTYEYOwRXaNXGXGUdWnLzNjYtyBjkOwuH4vVB4dgsjAsPsAoeheWLLqDXhs0SKD+OryEuNImKf2cK/7ACpDYquQVPGox30Bd1YhfjN6YvFz8NSSCqhYrTFVheugaW0twN1ZqfA7Et2DwjzPRhrdAeAnHD76lmNfwImf/2RK//oH/Pvbg5xE96AwT1VHb3EB+ET0umsFMJdOwnVNY7rT0/1oA8y0t7HzRxaA5AkAcT7gGo4GVADz3Qd0iQCdiWl2r+H3gJsAOOir7x6GlQ2tzEzfle9g8voE081z5+BWfA/Mf3xc11+/3IaHs9Pse4yP9g+zezGPf8fBBZNv9UKw+4w7ALywkrz2v38U5scumZQZHNRj0Lz494nqB1NRAFTxdx7+DqmZe9D1yUUonbgKvkSaHfPXVYaKBkCvxCoAPA+saYI1DduZyZGp23AqOQWlXw5BYPgiO8brZ8enGUB8607YuTEqzUMA/KZpG4B/hVYBoHk0h0LDWPHSeDtoZwbYMX2H+mcyBRlFHgIwvKU6BcCvGHwMLzRLwhbSZmb088GRlCneCoCUNwAGLws3szUfza8dlf+n2dQYhfjuLoPQ5FeTP5gA8PqHp86a4sVJvHJzzFAwFPpYrrXmDsFvWKJ4ADQAc3MG4fXW3ftNAFbxPEC2cW0BiINZGZIpGwDflrYBltVuYjfxEgFi29thfDRpkBWAVbwIII798tbO/ABkyiUu37z5evgPmN21RAkYlXIAAAAASUVORK5CYII=\") 10 7, not-allowed; }\nhtml[data-dsh-skin=\"miku\"] [draggable='true'], html[data-dsh-skin=\"miku\"] [class*='dragHandle'],\nhtml[data-dsh-skin=\"miku\"] [class*='drag-handle'], html[data-dsh-skin=\"miku\"] [class*='grab'] { cursor: url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAABPklEQVR4nO2YPwvCQAzF+7EcLIgIXTooDiqIgoODuHTTQdxdnNTVxU1wFFo3P1glhZNc7V961+YwP3hLkUveEfJsLYthGIZhGJmW7YZxNd1TIUSz9syT1J6szTAhDDjXl6Tu/kLfgLh5aHj59iVNn0H0nOQ44bHpbQ7h4B78GJgHfvSc5DjhsUlqHovkOAkDWY1jjc4nmgagsSJytzuaBsqKVMNNnlO6IGySzsILnZVX2YDtjqNzatlOSdumqgFovpbtlBZSqgxoC7u8kFJpQEvY5YWUSgNawo4NsAFFGLuFcDHYDHAzUAg2hkoDcObw9vjevJY8MDrI4oWN/C+UVViVajGgylAjzSYhGjL+jQxvpzTBb/rHM00Dxr7UC9LCjvx3IUE87LC0h5Qq8DgZ92kRQ3ptFsF4AwzDMP/DB2qttS80hxy9AAAAAElFTkSuQmCC\") 22 24, grab; }\nhtml[data-dsh-skin=\"miku\"] [class*='crosshair'] { cursor: url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAADfklEQVR4nO2ZTUwTURDHuXPywkGPeiMh8VYRQkKUr5CIYoQC0Rj5EEGgmBAlQIloiSQUEKmiglVikIRIDTRiKUppNMaDiRoPXrzoBT0Z746ZMbN5+7q7VLrd7Rpf8k/3badv5vd23rzXNivLoLkKK0GWkX3GNQ668KQHDlY3ORegNBiFYu9N5wI0xyNQE5j6D2B5+2cAMnoNaJVKWSLAdso4gFTtLQHAOo+zjLnOwj4KbfgeXuO9o4tril3D0zWysxUANylMEVyoLOyjZAC8Vz4cUOyqxgKq9LIFwNEpZNQcUYWMGgNgzmPaOBbA8RuZ4wGwVGK1MRPAkgKQzkVsKYCZTsS0ZGUEgJ6t3n6BgZ9eeaysre0+YzqcGQBy8LYAiE4aC+oheqA34SQrnp30JJ+pUDjWeH6bdetEBMgvq6VDIgZfu7w9wKm1CNmWnvNAcX1jAgDeP3ymzXwIPQCtE26y4tQSAdKyF/HMiJVErjA7kVY6WQLAaZMqAKcT/R5V1wWu6s4/YA8fkD/T1oMMkEraaIk20Kln4BpYSc++IQPwtRyEXhXiVHEsQNd6FK6EYgSCaSO/T8f4uxkMMP36BcC7N4Y2NYur9gBwemCAm7GXmqnCAKj1cDwhUNsA0Gnl9Dy4uq/C8qQf5mbuaaaKCLC6EILc2j6o8A1CVWCSbG0DQId59V7YnZNDaj5+TDNVRIDQ2Ajsys4m7S0sUZ6YLQAVbX3gGw1QYAyB4mBlceAo7MeXQjSGbVUInZ+/eJnSRwXw6b1KX2MR1cyjsO8f8tkPkH+kThU86te3LyotBe+ogmfty91vDwDvxJRCU7MJAaO2ImHYcLtJH68Na9psbsSsB8DXEk8/fXcu758Az+R9CkQP4O3ZFvh8Y1wz+NsLT2gMHKvIG7QGoFk4LeLMlfnnaRb1AL4PD8GPR3MJ7+NnMHjlNFrdaT2AKAzoUEO70u9p6YCf0eUEG5be10vbADD4E00XoLdnkOT3+iB8fULpo9CGlREAsg0GCVtbpPVQmGy4jzL6zmsZgN6PX38DoOeD1xUrZQAegMpm34hycBMB2AaDn5+ZU4IfvTULea3ddP0h/oruo42n45LhExAB0G+Bu33nEFqD6gHIM43B74k9B70nsxNfpgDIj1VezMnKyCdvlKYB8P9oWv+RpQMA04b9FbUOpA6QjGMzm5bf31+3cHQjB9p3AAAAAElFTkSuQmCC\") 10 5, crosshair; }\nhtml[data-dsh-skin=\"miku\"] [class*='explorer-handle'], html[data-dsh-skin=\"miku\"] [class*='preview-handle'],\nhtml[data-dsh-skin=\"miku\"] [class*='resizeHandle'] { cursor: url(\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAA4ElEQVR4nO2WsQrCMBRF+1li7eJSB5fiYIWiKOggLv0Cv0JdRXATFwWhcfPDIi+QEAQVY56hcg/c9d4e+qCNIgAAAAAAAAAANaKRdOVjQnQ4QUNxNpHJsFSJe1NngWYnNz2tweI3EjRCg+n2qtJebpwFfPR8NEihsewg5OxWqfTXK2eBdF6anuIiVDfLOdlnQw+fn/wLjESlulnOyX7detC3gA7LOT0b4xD4phMCoTvfDlK4Bdg+arqYHrjY77wLjM9H08X+PbCHfQmwnM2r8dr+C/kaDyoAAAAAAAAA+Avu9orQEw5bWDAAAAAASUVORK5CYII=\") 23 24, col-resize; }"

export default function defineSkinHooks() {
  return {
    apply(ctx) {
      const body = document.body
      const html = document.documentElement
      const originalHtmlTranslate = html.getAttribute('translate')
      const originalBodyTranslate = body.getAttribute('translate')
      const originalHtmlClass = html.getAttribute('class')
      const originalBodyClass = body.getAttribute('class')
      html.setAttribute('translate', 'no')
      body.setAttribute('translate', 'no')
      // Use an explicit class-attribute append (not classList.add) so teardown
      // can restore the exact original class attribute (jsdom keeps an empty
      // `class=""` after classList.remove, which the lifecycle test flags).
      const appendClass = (el, token) => {
        const current = el.getAttribute('class') ?? ''
        const tokens = current.split(/\s+/).filter(Boolean)
        if (!tokens.includes(token)) tokens.push(token)
        el.setAttribute('class', tokens.join(' '))
      }
      appendClass(html, 'notranslate')
      appendClass(body, 'notranslate')
      let translateMeta = document.querySelector('meta[name="google"][content="notranslate"]')
      const ownsTranslateMeta = translateMeta === null
      if (translateMeta === null) {
        translateMeta = document.createElement('meta')
        translateMeta.name = 'google'
        translateMeta.content = 'notranslate'
        document.head.prepend(translateMeta)
      }

      // Port of the v1 custom Miku cursors: a scoped style block injected for
      // this skin's active-skin scoping html[data-dsh-skin="miku"] (see
      // MIKU_CURSOR_CSS below, generated from the v1 cursor theme).
      const cursorStyle = document.createElement('style')
      cursorStyle.setAttribute('data-dsh-skin-cursor', '')
      cursorStyle.textContent = MIKU_CURSOR_CSS
      document.head.append(cursorStyle)

      // Port of the v1 right-panel collapse handling: when the aionui panel
      // collapses to a thin rail, hide the "collapse" chevron and show the
      // floating "expand" button. A lightweight poll keeps the body flag
      // current across open/close; skin.css uses it to keep the two floating
      // buttons from overlapping. dsh-aionui-panel is deprecated upstream, so
      // this stays defensive and self-contained.
      const syncPanelCollapsed = () => {
        const collapsed = Array.from(document.querySelectorAll('.aionui-root')).some(
          (root) => root.getBoundingClientRect().width < 24,
        )
        if (collapsed) body.dataset.dshAionuiCollapsed = ''
        else delete body.dataset.dshAionuiCollapsed
      }
      syncPanelCollapsed()
      const panelTimer = setInterval(syncPanelCollapsed, 500)

      // 输入卡（composer）settling 阶段可见性改由 patches.css 用稳定语义锚点
      // （data-composer-seat / data-composer-card / data-dsh-part）声明式修复，
      // 颜色走 --dsw-alias-* token。不再用 JS 每帧写内联 !important，避免对抗
      // rc.8 shell 的 settling 状态机并绕过皮肤中心 token 体系。

      const originalTitle = document.title
      // Resolve the pinned title once up front so the title-bar text and the
      // document title always agree, and the dispose check compares against the
      // exact value the skin wrote.
      const pinnedTitle = resolveTitle()

      const titlebar = document.createElement('div')
      titlebar.className = CLS.mikuTitlebar
      titlebar.dataset.skinChrome = 'titlebar'
      const icon = document.createElement('span')
      icon.className = CLS.mikuTitlebarIcon
      icon.innerHTML = NOTE_SVG
      const badge = document.createElement('span')
      badge.className = CLS.mikuTitlebarBadge
      badge.innerHTML = BADGE_SVG
      const title = document.createElement('span')
      title.className = CLS.mikuTitlebarTitle
      title.textContent = pinnedTitle
      titlebar.append(icon, badge, title)
      for (const glyph of TITLEBAR_GLYPHS) {
        const btn = document.createElement('span')
        btn.className = CLS.mikuTitlebarBtn
        btn.setAttribute('aria-hidden', 'true')
        btn.textContent = glyph
        titlebar.append(btn)
      }

      const statusbar = document.createElement('div')
      statusbar.className = CLS.mikuStatusbar
      statusbar.dataset.skinChrome = 'statusbar'
      const wave = document.createElement('span')
      wave.className = CLS.mikuStatusbarWave
      wave.innerHTML = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="12" viewBox="0 0 72 12" aria-hidden="true">',
        '<path d="M1 6h3l2-4 2 8 2-9 2 6 2-3 2 5 2-7 2 4 2-2 2 3 2-6 2 7 2-5 2 4 2-3 2 2 2-4 2 3 2-2 2 1 2-3 2 2 2-1 2 2 2-4 2 2 2-1 1 1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
        '</svg>',
      ].join('')
      const spacer = document.createElement('span')
      spacer.className = CLS.mikuStatusbarSpacer
      statusbar.append(wave, spacer)
      for (const cell of resolveCells()) {
        const el = document.createElement('span')
        el.className = CLS.mikuStatusbarCell
        el.dataset.skinCell = ''
        el.textContent = cell
        statusbar.append(el)
      }

      const favicon = document.createElement('link')
      favicon.rel = 'icon'
      favicon.href = `data:image/svg+xml;utf8,${encodeURIComponent(FAVICON_SVG)}`
      document.head.append(favicon)

      document.title = pinnedTitle
      body.append(titlebar, statusbar)

      ctx.onCleanup(() => {
        cursorStyle.remove()
        clearInterval(panelTimer)
        if (originalHtmlTranslate === null) html.removeAttribute('translate')
        else html.setAttribute('translate', originalHtmlTranslate)
        if (originalBodyTranslate === null) body.removeAttribute('translate')
        else body.setAttribute('translate', originalBodyTranslate)
        // Restore the exact original class attribute (or remove it when it did
        // not exist) so no empty class="" survives in jsdom/real DOM.
        if (originalHtmlClass === null) html.removeAttribute('class')
        else html.setAttribute('class', originalHtmlClass)
        if (originalBodyClass === null) body.removeAttribute('class')
        else body.setAttribute('class', originalBodyClass)
        if (ownsTranslateMeta) translateMeta.remove()
        delete body.dataset.dshAionuiCollapsed
        titlebar.remove()
        statusbar.remove()
        favicon.remove()
        // Only restore when the skin's own title still stands — a session title
        // projected by the shell must not be clobbered by skin teardown.
        if (document.title === pinnedTitle) document.title = originalTitle
      })
    },
  }
}
