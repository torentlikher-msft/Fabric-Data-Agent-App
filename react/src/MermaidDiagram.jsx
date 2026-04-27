import { useEffect, useId, useRef, useState } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'strict',
  fontFamily: 'inherit',
  themeVariables: {
    mainBkg: 'transparent',
  },
  flowchart: { htmlLabels: true },
})

export default function MermaidDiagram({ chart }) {
  const id = useId().replace(/:/g, '_')
  const containerRef = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function render() {
      if (!chart?.trim() || !containerRef.current) return

      try {
        const { svg } = await mermaid.render(`mermaid-${id}`, chart.trim())
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram')
        }
      }
    }

    render()
    return () => { cancelled = true }
  }, [chart, id])

  if (error) {
    return (
      <div className="mermaid-error">
        <p>Could not render diagram</p>
        <pre><code>{chart}</code></pre>
      </div>
    )
  }

  return <div className="mermaid-diagram" ref={containerRef} />
}
