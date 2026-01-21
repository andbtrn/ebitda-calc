import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
} from 'react'
import { supabase, createWorkspace as createWorkspaceRPC } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { Workspace, Membership } from '../types/database'

interface WorkspaceContextType {
  workspaces: Workspace[]
  currentWorkspace: Workspace | null
  currentMembership: Membership | null
  loading: boolean
  error: string | null
  setCurrentWorkspace: (workspace: Workspace) => void
  createWorkspace: (name: string) => Promise<{ error: string | null }>
  refreshWorkspaces: () => Promise<void>
  isAdmin: boolean
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(
  undefined
)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(
    null
  )
  const [currentMembership, setCurrentMembership] = useState<Membership | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refreshWorkspaces = useCallback(async () => {
    if (!user) {
      setWorkspaces([])
      setCurrentWorkspace(null)
      setCurrentMembership(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Получаем memberships пользователя
      const { data: memberships, error: membershipError } = await supabase
        .from('memberships')
        .select('*, workspace:workspaces(*)')
        .eq('user_id', user.id)

      if (membershipError) throw membershipError

      const workspaceList = memberships
        ?.map((m) => m.workspace as unknown as Workspace)
        .filter(Boolean) || []

      setWorkspaces(workspaceList)

      // Если есть workspaces и текущий не выбран
      if (workspaceList.length > 0 && !currentWorkspace) {
        const savedId = localStorage.getItem('currentWorkspaceId')
        const saved = workspaceList.find((w) => w.id === savedId)
        const workspace = saved || workspaceList[0]
        setCurrentWorkspace(workspace)

        // Находим membership для текущего workspace
        const membership = memberships?.find(
          (m) => (m.workspace as unknown as Workspace)?.id === workspace.id
        )
        if (membership) {
          setCurrentMembership({
            id: membership.id,
            workspace_id: membership.workspace_id,
            user_id: membership.user_id,
            role: membership.role,
            created_at: membership.created_at,
          })
        }
      }
    } catch (err) {
      console.error('Error fetching workspaces:', err)
      setError('Ошибка загрузки организаций')
    } finally {
      setLoading(false)
    }
  }, [user, currentWorkspace])

  useEffect(() => {
    refreshWorkspaces()
  }, [user])

  useEffect(() => {
    if (currentWorkspace) {
      localStorage.setItem('currentWorkspaceId', currentWorkspace.id)
    }
  }, [currentWorkspace])

  const handleSetCurrentWorkspace = async (workspace: Workspace) => {
    setCurrentWorkspace(workspace)

    if (user) {
      const { data: memberships } = await supabase
        .from('memberships')
        .select('*')
        .eq('user_id', user.id)
        .eq('workspace_id', workspace.id)
        .single()

      setCurrentMembership(memberships)
    }
  }

  const createWorkspace = async (
    name: string
  ): Promise<{ error: string | null }> => {
    const result = await createWorkspaceRPC(name)

    if (!result.success) {
      return { error: result.error?.message || 'Ошибка создания организации' }
    }

    await refreshWorkspaces()

    // Устанавливаем новый workspace как текущий
    if (result.data?.workspace_id) {
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('*')
        .eq('id', result.data.workspace_id)
        .single()

      if (workspace) {
        setCurrentWorkspace(workspace)
      }
    }

    return { error: null }
  }

  const isAdmin = currentMembership?.role === 'admin'

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        currentWorkspace,
        currentMembership,
        loading,
        error,
        setCurrentWorkspace: handleSetCurrentWorkspace,
        createWorkspace,
        refreshWorkspaces,
        isAdmin,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider')
  }
  return context
}
