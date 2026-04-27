import { useEffect, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import MermaidDiagram from './MermaidDiagram'
import './App.css'

const DEFAULT_ENDPOINT = '<YOUR_FABRIC_DATA_AGENT_MCP_ENDPOINT>'

const STARTER_MESSAGE = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Sign in with your Microsoft credentials, then ask a question about your Fabric data.',
}

function App() {
  const [question, setQuestion] = useState('')
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT)
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('fabric_messages')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {
      // fall through to default
    }
    return [STARTER_MESSAGE]
  })
  const [activeTool, setActiveTool] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authErrorText, setAuthErrorText] = useState('')
  const [errorText, setErrorText] = useState('')
  const viewportRef = useRef(null)

  useEffect(() => {
    const savedEndpoint = localStorage.getItem('fabric_endpoint')
    if (savedEndpoint) setEndpoint(savedEndpoint)
  }, [])

  useEffect(() => {
    localStorage.setItem('fabric_endpoint', endpoint)
  }, [endpoint])

  useEffect(() => {
    try {
      localStorage.setItem('fabric_messages', JSON.stringify(messages))
    } catch {
      // ignore quota errors
    }
  }, [messages])

  useEffect(() => {
    async function checkAuthStatus() {
      try {
        const response = await fetch('/api/auth/status')
        const payload = await response.json()
        setIsAuthenticated(Boolean(payload?.authenticated))
      } catch {
        setIsAuthenticated(false)
      } finally {
        setIsAuthLoading(false)
      }
    }

    checkAuthStatus()
  }, [])

  useEffect(() => {
    if (!viewportRef.current) return
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight
  }, [messages, isSending])

  const canSend = useMemo(
    () => question.trim().length > 0 && !isSending && !isAuthLoading && isAuthenticated,
    [question, isSending, isAuthLoading, isAuthenticated],
  )

  async function signIn() {
    setIsSigningIn(true)
    setAuthErrorText('')

    try {
      const response = await fetch('/api/auth/login', { method: 'POST' })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error || 'Sign-in failed.')
      }

      setIsAuthenticated(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign-in failed.'
      setAuthErrorText(message)
      setIsAuthenticated(false)
    } finally {
      setIsSigningIn(false)
    }
  }

  function disconnectSession() {
    setIsAuthenticated(false)
    setAuthErrorText('')
  }

  function clearChat() {
    setMessages([STARTER_MESSAGE])
    setActiveTool('')
    setErrorText('')
  }

  async function sendQuestion() {
    if (!canSend) return

    const cleanQuestion = question.trim()
    setQuestion('')
    setIsSending(true)
    setErrorText('')

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: cleanQuestion,
      },
    ])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: cleanQuestion,
          endpoint: endpoint.trim() || DEFAULT_ENDPOINT,
        }),
      })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error || 'Request failed.')
      }

      setActiveTool(payload.tool || '')
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: payload.reply || 'No response text was returned.',
        },
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error'
      setErrorText(message)
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `I could not complete that request: ${message}`,
        },
      ])
    } finally {
      setIsSending(false)
    }
  }

  function onInputKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendQuestion()
    }
  }

  return (
    <main className="page-shell">
      <section className="chat-panel">
        <header className="panel-header">
          <p className="eyebrow">Fabric Data Agent</p>
          <h1>Chat with your data</h1>
          <p className="subtitle">
            Ask natural-language questions and get responses from your MCP-backed
            data agent in one screen.
          </p>
          {activeTool && <p className="tool-chip">Tool used: {activeTool}</p>}
          <button type="button" className="header-action-btn" onClick={clearChat}>
            Clear chat
          </button>
        </header>

        <section className="settings-grid" aria-label="Connection settings">
          <div className="settings-field auth-field">
            Authentication
            <div className="auth-panel">
              {isAuthenticated ? (
                <>
                  <p className="auth-state">Connected with your Microsoft credentials.</p>
                  <button type="button" className="secondary-btn" onClick={disconnectSession}>
                    Disconnect app session
                  </button>
                </>
              ) : (
                <>
                  <p className="auth-state">
                    Use your Microsoft account from local credentials.
                  </p>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={signIn}
                    disabled={isSigningIn || isAuthLoading}
                  >
                    {isSigningIn ? 'Signing in...' : 'Sign in with Microsoft credentials'}
                  </button>
                </>
              )}
            </div>
          </div>

          <label className="settings-field">
            MCP endpoint
            <input
              type="url"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder={DEFAULT_ENDPOINT}
            />
          </label>
        </section>

        {authErrorText && (
          <p className="error-text" role="alert">
            {authErrorText}
          </p>
        )}

        <section className="messages" ref={viewportRef} aria-live="polite">
          {messages.map((message) => (
            <article key={message.id} className={`bubble ${message.role}`}>
              <p className="role-label">{message.role === 'user' ? 'You' : 'Agent'}</p>
              <div className="message-text">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                  components={{
                    code({ className, children, ...rest }) {
                      const match = /language-(\w+)/.exec(className || '')
                      if (match && match[1] === 'mermaid') {
                        return <MermaidDiagram chart={String(children).replace(/\n$/, '')} />
                      }
                      return <code className={className} {...rest}>{children}</code>
                    },
                    pre({ children }) {
                      return <pre>{children}</pre>
                    },
                  }}
                >
                  {message.content}
                </Markdown>
              </div>
            </article>
          ))}

          {isSending && (
            <article className="bubble assistant pending">
              <p className="role-label">Agent</p>
              <p className="message-text">Thinking...</p>
            </article>
          )}
        </section>

        <section className="composer" aria-label="Question composer">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={onInputKeyDown}
            rows={3}
            disabled={!isAuthenticated || isSending || isAuthLoading}
            placeholder={
              isAuthenticated
                ? 'Example: Which product categories had the highest week-over-week growth?'
                : 'Sign in first, then ask your data question...'
            }
          />
          <button type="button" disabled={!canSend} onClick={sendQuestion}>
            {isSending ? 'Sending...' : 'Ask data agent'}
          </button>
        </section>

        {errorText && (
          <p className="error-text" role="alert">
            {errorText}
          </p>
        )}
      </section>
    </main>
  )
}

export default App
