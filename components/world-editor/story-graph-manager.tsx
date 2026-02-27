'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Plus,
  Save,
  Copy,
  Trash2,
  Play,
  Settings,
  GitBranch,
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  MiniMap,
  NodeTypes,
  EdgeTypes,
  EdgeProps,
  ReactFlowProvider,
  OnConnect,
  getBezierPath,
  MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'

interface StoryGraphManagerProps {
  worldId: string
}

// Custom Node Component
const NODE_TYPE_COLORS: Record<string, string> = {
  start:           '#6EE7F2',
  objective:       '#F2B880',
  branch:          '#DA77F2',
  climax:          '#FF6B6B',
  ending_good:     '#6EF287',
  ending_bad:      '#FF4444',
  ending_neutral:  '#AAAAAA',
  side_start:      '#87CEEB',
  side_end:        '#87CEEB',
}

const StoryNodeComponent = ({ data, selected }: { data: { name: string; description: string; node_type?: string; is_start_node?: boolean; interactive_hints?: string[]; trigger_conditions?: Record<string, unknown> }; selected: boolean }) => {
  const nodeType = data.node_type ?? 'objective'
  const accentColor = NODE_TYPE_COLORS[nodeType] ?? '#F2B880'

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`px-4 py-2 shadow-lg rounded-lg border-2 min-w-[200px] max-w-[280px] ${
        selected
          ? 'bg-gradient-to-br from-[#6EE7F2]/20 to-[#DA77F2]/20'
          : 'bg-gradient-to-br from-bg-1 to-bg-2'
      }`}
      style={{ borderColor: selected ? accentColor : `${accentColor}50` }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Play className="w-4 h-4" style={{ color: accentColor }} />
        <h3 className="font-semibold text-fg-0 text-sm flex-1">{data.name}</h3>
        {data.is_start_node && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#DA77F2]/20 text-[#DA77F2] font-medium">START</span>
        )}
      </div>
      <p className="text-xs text-fg-1 line-clamp-2">{data.description}</p>
      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${accentColor}20`, color: accentColor }}>
          {nodeType}
        </span>
        {data.interactive_hints && data.interactive_hints.length > 0 && (
          <div className="flex items-center gap-1">
            <Settings className="w-3 h-3 text-[#F2B880]" />
            <span className="text-xs text-[#F2B880]">{data.interactive_hints.length} hints</span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// Custom Edge Component — must render the SVG path itself
const EDGE_TYPE_COLORS: Record<string, string> = {
  story:    '#6EE7F2',
  fail:     '#FF4444',
  shortcut: '#F2B880',
  secret:   '#DA77F2',
}

const StoryEdgeComponent = ({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data, selected, markerEnd,
}: EdgeProps<{ label?: string; priority?: number; edge_type?: string }>) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  const edgeType = data?.edge_type ?? 'story'
  const color = selected ? '#ffffff' : (EDGE_TYPE_COLORS[edgeType] ?? '#6EE7F2')
  const opacity = selected ? 1 : 0.85

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
        stroke={color}
        strokeWidth={selected ? 3 : 2.2}
        strokeOpacity={opacity}
        fill="none"
        strokeDasharray={edgeType === 'secret' ? '5 3' : undefined}
      />
      {data?.label && (
        <foreignObject
          width={120} height={24}
          x={labelX - 60} y={labelY - 12}
          style={{ overflow: 'visible' }}
        >
          <div
            className="px-1.5 py-0.5 rounded text-[10px] text-center leading-tight whitespace-nowrap"
            style={{
              backgroundColor: 'rgba(10,10,20,0.85)',
              color: color,
              border: `1px solid ${color}40`,
            }}
          >
            {data.label}
          </div>
        </foreignObject>
      )}
    </>
  )
}

// ============================================================
// Hierarchical Auto-Layout
// ============================================================
type RawNode = { id: string; is_start_node?: boolean }
type RawEdge = { from_node_id: string; to_node_id: string }

function computeHierarchicalLayout(
  rawNodes: RawNode[],
  rawEdges: RawEdge[]
): Map<string, { x: number; y: number }> {
  const NODE_W = 300
  const NODE_H = 130
  const H_GAP = 80
  const V_GAP = 100

  // Build adjacency
  const outgoing = new Map<string, string[]>()
  const incomingCount = new Map<string, number>()
  for (const n of rawNodes) {
    outgoing.set(n.id, [])
    incomingCount.set(n.id, 0)
  }
  for (const e of rawEdges) {
    outgoing.get(e.from_node_id)?.push(e.to_node_id)
    incomingCount.set(e.to_node_id, (incomingCount.get(e.to_node_id) ?? 0) + 1)
  }

  // Find roots: is_start_node OR no incoming edges
  const layers = new Map<string, number>()
  const queue: string[] = []
  for (const n of rawNodes) {
    if (n.is_start_node || incomingCount.get(n.id) === 0) {
      layers.set(n.id, 0)
      queue.push(n.id)
    }
  }
  // If nothing qualifies, put first node as root
  if (queue.length === 0 && rawNodes.length > 0) {
    layers.set(rawNodes[0].id, 0)
    queue.push(rawNodes[0].id)
  }

  // BFS to assign layers
  let head = 0
  while (head < queue.length) {
    const nodeId = queue[head++]
    const layer = layers.get(nodeId) ?? 0
    for (const targetId of outgoing.get(nodeId) ?? []) {
      if (!layers.has(targetId)) {
        layers.set(targetId, layer + 1)
        queue.push(targetId)
      }
    }
  }
  // Disconnected nodes get placed at the end
  let maxLayer = 0
  for (const l of layers.values()) maxLayer = Math.max(maxLayer, l)
  for (const n of rawNodes) {
    if (!layers.has(n.id)) layers.set(n.id, maxLayer + 1)
  }

  // Group by layer
  const byLayer = new Map<number, string[]>()
  for (const [nodeId, layer] of layers) {
    if (!byLayer.has(layer)) byLayer.set(layer, [])
    byLayer.get(layer)!.push(nodeId)
  }

  // Compute max width for centering
  let maxLayerWidth = 0
  for (const nodeIds of byLayer.values()) {
    maxLayerWidth = Math.max(maxLayerWidth, nodeIds.length * (NODE_W + H_GAP) - H_GAP)
  }

  const positions = new Map<string, { x: number; y: number }>()
  for (const [layer, nodeIds] of byLayer) {
    const layerWidth = nodeIds.length * (NODE_W + H_GAP) - H_GAP
    const xStart = (maxLayerWidth - layerWidth) / 2
    nodeIds.forEach((nodeId, index) => {
      positions.set(nodeId, {
        x: xStart + index * (NODE_W + H_GAP),
        y: layer * (NODE_H + V_GAP),
      })
    })
  }

  return positions
}

const nodeTypes: NodeTypes = {
  storyNode: StoryNodeComponent,
}

const edgeTypes: EdgeTypes = {
  storyEdge: StoryEdgeComponent,
}

export function StoryGraphManager({ worldId }: StoryGraphManagerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [isEditingNode, setIsEditingNode] = useState(false)
  const [isEditingEdge, setIsEditingEdge] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const supabase = createClient()
  const { user } = useAuth()

  const [nodeFormData, setNodeFormData] = useState({
    name: '',
    aliases: '',
    description: '',
    trigger_conditions: '{}',
    node_type: 'objective',
    is_start_node: false,
    interactive_hints: '',
    completion_trigger: '',
  })

  const [edgeFormData, setEdgeFormData] = useState({
    label: '',
    priority: 0,
    condition: '',
    edge_type: 'story',
  })

  const fetchStoryData = useCallback(async () => {
    try {
      // Fetch nodes
      const { data: nodesData, error: nodesError } = await supabase
        .from('story_nodes')
        .select('*')
        .eq('world_id', worldId)
        .order('created_at', { ascending: false })

      if (nodesError) throw nodesError

      // Fetch edges
      const { data: edgesData, error: edgesError } = await supabase
        .from('story_edges')
        .select('*')
        .eq('world_id', worldId)

      if (edgesError) throw edgesError

      // Compute hierarchical layout based on edge connections
      const positions = computeHierarchicalLayout(
        nodesData ?? [],
        edgesData ?? []
      )

      // Convert to React Flow format
      const flowNodes: Node[] = nodesData?.map((node) => ({
        id: node.id,
        type: 'storyNode',
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        data: {
          name: node.name,
          description: node.description,
          trigger_conditions: node.trigger_conditions,
          node_type: node.node_type ?? 'objective',
          is_start_node: node.is_start_node ?? false,
          interactive_hints: node.interactive_hints ?? [],
          completion_trigger: node.completion_trigger ?? null,
        },
      })) || []

      const flowEdges: Edge[] = edgesData?.map((edge) => ({
        id: edge.id,
        source: edge.from_node_id,
        target: edge.to_node_id,
        type: 'storyEdge',
        data: {
          label: edge.label || edge.condition || null,
          priority: edge.priority,
          edge_type: edge.edge_type ?? 'story',
          condition: edge.condition ?? null,
        },
        animated: edge.edge_type === 'fail',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: EDGE_TYPE_COLORS[edge.edge_type ?? 'story'] ?? '#6EE7F2',
          width: 18,
          height: 18,
        },
      })) || []

      setNodes(flowNodes)
      setEdges(flowEdges)
    } catch {
      toast.error('Failed to load story graph')
    } finally {
      setLoading(false)
    }
  }, [supabase, worldId, setNodes, setEdges])

  useEffect(() => {
    fetchStoryData()
  }, [fetchStoryData])

  const onConnect: OnConnect = useCallback(
    async (params: Connection) => {
      if (!params.source || !params.target) return

      try {
        const { data: newEdge, error } = await supabase
          .from('story_edges')
          .insert({
            world_id: worldId,
            from_node_id: params.source,
            to_node_id: params.target,
            label: 'New Path',
            priority: 0,
          })
          .select()
          .single()

        if (error) throw error

        const edge: Edge = {
          id: newEdge.id,
          source: params.source,
          target: params.target,
          type: 'storyEdge',
          data: {
            label: newEdge.label,
            priority: newEdge.priority,
            edge_type: 'story',
            condition: null,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#6EE7F2',
            width: 18,
            height: 18,
          },
        }

        setEdges((eds) => addEdge(edge, eds))
        toast.success('Story connection created!')
      } catch {
        toast.error('Failed to create story connection')
      }
    },
    [worldId, supabase, setEdges]
  )

  const handleAddNode = async () => {
    try {
      const { data: newNode, error } = await supabase
        .from('story_nodes')
        .insert({
          world_id: worldId,
          name: 'New Story Node',
          description: 'A new story node waiting to be defined',
          aliases: [],
          trigger_conditions: {},
          created_by: user?.id,
        })
        .select()
        .single()

      if (error) throw error

      const nodeCount = nodes.length
      const newNodeFlow: Node = {
        id: newNode.id,
        type: 'storyNode',
        position: {
          x: (nodeCount % 3) * 300 + 100,
          y: Math.floor(nodeCount / 3) * 200 + 100
        },
        data: {
          name: newNode.name,
          description: newNode.description,
          trigger_conditions: newNode.trigger_conditions,
          node_type: newNode.node_type ?? 'objective',
          is_start_node: newNode.is_start_node ?? false,
          interactive_hints: newNode.interactive_hints ?? [],
          completion_trigger: newNode.completion_trigger ?? null,
        },
      }

      setNodes((nds) => [...nds, newNodeFlow])
      toast.success('Story node created!')
    } catch {
      toast.error('Failed to create story node')
    }
  }

  const handleNodeClick = (event: React.MouseEvent, node: Node) => {
    setSelectedNode(node)
    setSelectedEdge(null)
    
    // Find the actual story node data
    const storyNode = nodes.find(n => n.id === node.id)
    if (storyNode) {
      setNodeFormData({
        name: storyNode.data.name,
        aliases: '',
        description: storyNode.data.description,
        trigger_conditions: JSON.stringify(storyNode.data.trigger_conditions || {}, null, 2),
        node_type: storyNode.data.node_type ?? 'objective',
        is_start_node: storyNode.data.is_start_node ?? false,
        interactive_hints: (storyNode.data.interactive_hints ?? []).join('\n'),
        completion_trigger: storyNode.data.completion_trigger ?? '',
      })
    }
    
    // Open the editing modal
    setIsEditingNode(true)
  }

  const handleEdgeClick = (event: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge)
    setSelectedNode(null)
    
    setEdgeFormData({
      label: edge.data?.label || '',
      priority: edge.data?.priority || 0,
      condition: edge.data?.condition || '',
      edge_type: edge.data?.edge_type || 'story',
    })
    
    // Open the editing modal
    setIsEditingEdge(true)
  }

  const handleSaveNode = async () => {
    if (!selectedNode || !nodeFormData.name.trim() || !nodeFormData.description.trim()) {
      toast.error('Name and description are required')
      return
    }

    setSaving(true)
    try {
      let triggerConditions = {}
      try {
        triggerConditions = JSON.parse(nodeFormData.trigger_conditions)
      } catch {
        toast.error('Invalid JSON in trigger conditions')
        return
      }

      const hints = nodeFormData.interactive_hints
        .split('\n')
        .map(h => h.trim())
        .filter(Boolean)

      const { error } = await supabase
        .from('story_nodes')
        .update({
          name: nodeFormData.name.trim(),
          description: nodeFormData.description.trim(),
          aliases: nodeFormData.aliases.split(',').map(a => a.trim()).filter(Boolean),
          trigger_conditions: triggerConditions,
          node_type: nodeFormData.node_type,
          is_start_node: nodeFormData.is_start_node,
          interactive_hints: hints,
          completion_trigger: nodeFormData.completion_trigger.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedNode.id)

      if (error) throw error

      // Update the node in the flow
      setNodes((nds) =>
        nds.map((node) =>
          node.id === selectedNode.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  name: nodeFormData.name.trim(),
                  description: nodeFormData.description.trim(),
                  trigger_conditions: triggerConditions,
                  node_type: nodeFormData.node_type,
                  is_start_node: nodeFormData.is_start_node,
                  interactive_hints: hints,
                  completion_trigger: nodeFormData.completion_trigger.trim() || null,
                },
              }
            : node
        )
      )

      toast.success('Story node updated!')
      setIsEditingNode(false)
    } catch {
      toast.error('Failed to save story node')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveEdge = async () => {
    if (!selectedEdge) return

    setSaving(true)
    try {
      const { error } = await supabase
        .from('story_edges')
        .update({
          label: edgeFormData.label.trim() || null,
          priority: edgeFormData.priority,
          condition: edgeFormData.condition.trim() || null,
          edge_type: edgeFormData.edge_type,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedEdge.id)

      if (error) throw error

      // Update the edge in the flow
      setEdges((eds) =>
        eds.map((edge) =>
          edge.id === selectedEdge.id
            ? {
                ...edge,
                data: {
                  ...edge.data,
                  label: edgeFormData.label.trim(),
                  priority: edgeFormData.priority,
                  condition: edgeFormData.condition.trim() || null,
                  edge_type: edgeFormData.edge_type,
                },
                animated: edgeFormData.priority > 0,
              }
            : edge
        )
      )

      toast.success('Story edge updated!')
      setIsEditingEdge(false)
    } catch {
      toast.error('Failed to save story edge')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteNode = async () => {
    if (!selectedNode) return

    if (!confirm('Are you sure you want to delete this story node? This will also delete all connected edges.')) {
      return
    }

    try {
      const { error } = await supabase
        .from('story_nodes')
        .delete()
        .eq('id', selectedNode.id)

      if (error) throw error

      setNodes((nds) => nds.filter((node) => node.id !== selectedNode.id))
      setEdges((eds) => eds.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id))
      setSelectedNode(null)
      setIsEditingNode(false)
      toast.success('Story node deleted!')
    } catch {
      toast.error('Failed to delete story node')
    }
  }

  const handleDeleteEdge = async () => {
    if (!selectedEdge) return

    try {
      const { error } = await supabase
        .from('story_edges')
        .delete()
        .eq('id', selectedEdge.id)

      if (error) throw error

      setEdges((eds) => eds.filter((edge) => edge.id !== selectedEdge.id))
      setSelectedEdge(null)
      setIsEditingEdge(false)
      toast.success('Story edge deleted!')
    } catch {
      toast.error('Failed to delete story edge')
    }
  }

  const handleCopyJSON = () => {
    const data = {
      nodes: nodes.map(node => ({
        id: node.id,
        name: node.data.name,
        description: node.data.description,
        trigger_conditions: node.data.trigger_conditions,
      })),
      edges: edges.map(edge => ({
        id: edge.id,
        from: edge.source,
        to: edge.target,
        label: edge.data?.label,
        priority: edge.data?.priority,
      })),
    }
    
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    toast.success('Story graph data copied to clipboard!')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="flex items-center gap-3 text-fg-1">
          <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse" />
          <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse delay-75" />
          <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse delay-150" />
          Loading story graph...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card className="bg-gradient-to-br from-bg-1 to-bg-2 border-[#6EE7F2]/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-semibold text-[#6EE7F2] flex items-center gap-2">
                <GitBranch className="w-5 h-5" />
                Story Graph
              </h3>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleAddNode}
                  className="bg-gradient-to-r from-[#6EE7F2] to-[#F2B880] hover:from-[#F2B880] hover:to-[#6EE7F2] text-bg-0 font-semibold"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Node
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCopyJSON}
                  className="border-[#6EE7F2]/30 hover:border-[#6EE7F2]"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy JSON
                </Button>
              </div>
            </div>
            <div className="text-sm text-fg-1">
              {nodes.length} nodes, {edges.length} connections
            </div>
          </div>
        </CardContent>
      </Card>

      {/* React Flow Canvas */}
      <Card className="bg-gradient-to-br from-bg-1 to-bg-2 border-[#6EE7F2]/20">
        <CardContent className="p-0">
          <div className="h-[600px] w-full">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              attributionPosition="bottom-left"
              className="bg-bg-0"
            >
              <Controls className="bg-bg-2 border-border" />
              <MiniMap 
                className="bg-bg-2 border-border"
                nodeColor="#6EE7F2"
                maskColor="rgba(0, 0, 0, 0.5)"
              />
              <Background color="#6EE7F2" gap={20} size={1} />
            </ReactFlow>
          </div>
        </CardContent>
      </Card>

      {/* Node Inspector Modal */}
      <Dialog open={isEditingNode} onOpenChange={setIsEditingNode}>
        <DialogContent className="bg-bg-0 border-[#6EE7F2]/30 max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="space-y-6">
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-[#6EE7F2] to-[#F2B880] bg-clip-text text-transparent">
              Edit Story Node
            </DialogTitle>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="node-name" className="text-[#6EE7F2] font-semibold">
                  Node Name *
                </Label>
                <Input
                  id="node-name"
                  value={nodeFormData.name}
                  onChange={(e) => setNodeFormData({ ...nodeFormData, name: e.target.value })}
                  className="bg-bg-2 border-border focus:border-[#6EE7F2] focus:ring-[#6EE7F2]/20 transition-all"
                  placeholder="Enter story node name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="node-aliases" className="text-[#DA77F2] font-semibold">
                  Aliases (comma-separated)
                </Label>
                <Input
                  id="node-aliases"
                  value={nodeFormData.aliases}
                  onChange={(e) => setNodeFormData({ ...nodeFormData, aliases: e.target.value })}
                  placeholder="Alternative names, comma-separated"
                  className="bg-bg-2 border-border focus:border-[#DA77F2] focus:ring-[#DA77F2]/20 transition-all"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="node-description" className="text-[#F2B880] font-semibold">
                  Description *
                </Label>
                <Textarea
                  id="node-description"
                  value={nodeFormData.description}
                  onChange={(e) => setNodeFormData({ ...nodeFormData, description: e.target.value })}
                  rows={4}
                  className="bg-bg-2 border-border focus:border-[#F2B880] focus:ring-[#F2B880]/20 transition-all"
                  placeholder="Describe this story node"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="node-type" className="text-[#6EE7F2] font-semibold">
                    Node Type
                  </Label>
                  <select
                    id="node-type"
                    value={nodeFormData.node_type}
                    onChange={(e) => setNodeFormData({ ...nodeFormData, node_type: e.target.value })}
                    className="w-full bg-bg-2 border border-border rounded-md px-3 py-2 text-sm text-fg-0 focus:border-[#6EE7F2] focus:outline-none focus:ring-1 focus:ring-[#6EE7F2]/20 [&>option]:bg-[#1a1a2e] [&>option]:text-[#e0e0e0]"
                  >
                    <option value="start">start</option>
                    <option value="objective">objective</option>
                    <option value="branch">branch</option>
                    <option value="climax">climax</option>
                    <option value="ending_good">ending_good</option>
                    <option value="ending_bad">ending_bad</option>
                    <option value="ending_neutral">ending_neutral</option>
                    <option value="side_start">side_start</option>
                    <option value="side_end">side_end</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label className="text-[#DA77F2] font-semibold">Start Node</Label>
                  <div
                    className="flex items-center gap-3 h-10 cursor-pointer"
                    onClick={() => setNodeFormData({ ...nodeFormData, is_start_node: !nodeFormData.is_start_node })}
                  >
                    <div className={`w-10 h-5 rounded-full transition-colors duration-200 flex items-center px-0.5 ${nodeFormData.is_start_node ? 'bg-[#DA77F2]' : 'bg-bg-0'}`}>
                      <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${nodeFormData.is_start_node ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                    <span className="text-sm text-fg-1">{nodeFormData.is_start_node ? 'Auto-activates at session start' : 'Manual activation'}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="node-hints" className="text-[#F2B880] font-semibold">
                  Interactive Hints <span className="font-normal text-fg-1 text-xs">(one per line — key things the DM should feature)</span>
                </Label>
                <Textarea
                  id="node-hints"
                  value={nodeFormData.interactive_hints}
                  onChange={(e) => setNodeFormData({ ...nodeFormData, interactive_hints: e.target.value })}
                  rows={3}
                  className="bg-bg-2 border-border focus:border-[#F2B880] focus:ring-[#F2B880]/20 transition-all text-sm"
                  placeholder={"the locked iron door\nthe glowing rune on the floor\nthe hooded figure in the corner"}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="node-completion" className="text-[#6EE7F2] font-semibold">
                  Completion Trigger <span className="font-normal text-fg-1 text-xs">(natural language — when does this node complete?)</span>
                </Label>
                <Textarea
                  id="node-completion"
                  value={nodeFormData.completion_trigger}
                  onChange={(e) => setNodeFormData({ ...nodeFormData, completion_trigger: e.target.value })}
                  rows={2}
                  className="bg-bg-2 border-border focus:border-[#6EE7F2] focus:ring-[#6EE7F2]/20 transition-all text-sm"
                  placeholder="Player speaks to the innkeeper and learns about the missing merchant"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="node-triggers" className="text-fg-1 font-semibold text-xs">
                  Trigger Conditions (JSON, legacy)
                </Label>
                <Textarea
                  id="node-triggers"
                  value={nodeFormData.trigger_conditions}
                  onChange={(e) => setNodeFormData({ ...nodeFormData, trigger_conditions: e.target.value })}
                  rows={3}
                  className="bg-bg-2 border-border focus:border-[#6EE7F2] focus:ring-[#6EE7F2]/20 transition-all font-mono text-xs"
                  placeholder='{}'
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                variant="outline"
                onClick={handleDeleteNode}
                className="border-red-500/30 hover:border-red-500 text-red-400"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
              <Button
                onClick={handleSaveNode}
                disabled={saving}
                className="bg-gradient-to-r from-[#6EE7F2] to-[#F2B880] hover:from-[#F2B880] hover:to-[#6EE7F2] text-bg-0 font-semibold"
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edge Inspector Modal */}
      <Dialog open={isEditingEdge} onOpenChange={setIsEditingEdge}>
        <DialogContent className="bg-bg-0 border-[#6EE7F2]/30 max-w-lg">
          <div className="space-y-6">
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-[#6EE7F2] to-[#F2B880] bg-clip-text text-transparent">
              Edit Story Edge
            </DialogTitle>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edge-label" className="text-[#6EE7F2] font-semibold">
                  Edge Label
                </Label>
                <Input
                  id="edge-label"
                  value={edgeFormData.label}
                  onChange={(e) => setEdgeFormData({ ...edgeFormData, label: e.target.value })}
                  className="bg-bg-2 border-border focus:border-[#6EE7F2] focus:ring-[#6EE7F2]/20 transition-all"
                  placeholder="Enter edge label"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edge-type" className="text-[#DA77F2] font-semibold">
                    Edge Type
                  </Label>
                  <select
                    id="edge-type"
                    value={edgeFormData.edge_type}
                    onChange={(e) => setEdgeFormData({ ...edgeFormData, edge_type: e.target.value })}
                    className="w-full bg-bg-2 border border-border rounded-md px-3 py-2 text-sm text-fg-0 focus:border-[#DA77F2] focus:outline-none focus:ring-1 focus:ring-[#DA77F2]/20 [&>option]:bg-[#1a1a2e] [&>option]:text-[#e0e0e0]"
                  >
                    <option value="story">story</option>
                    <option value="fail">fail</option>
                    <option value="shortcut">shortcut</option>
                    <option value="secret">secret</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edge-priority" className="text-[#F2B880] font-semibold">
                    Priority
                  </Label>
                  <Input
                    id="edge-priority"
                    type="number"
                    value={edgeFormData.priority}
                    onChange={(e) => setEdgeFormData({ ...edgeFormData, priority: parseInt(e.target.value) || 0 })}
                    className="bg-bg-2 border-border focus:border-[#F2B880] focus:ring-[#F2B880]/20 transition-all"
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edge-condition" className="text-[#6EE7F2] font-semibold">
                  Condition <span className="font-normal text-fg-1 text-xs">(what must be true to follow this path?)</span>
                </Label>
                <Textarea
                  id="edge-condition"
                  value={edgeFormData.condition}
                  onChange={(e) => setEdgeFormData({ ...edgeFormData, condition: e.target.value })}
                  rows={2}
                  className="bg-bg-2 border-border focus:border-[#6EE7F2] focus:ring-[#6EE7F2]/20 transition-all text-sm"
                  placeholder="Player has spoken to the innkeeper and accepted the quest"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                variant="outline"
                onClick={handleDeleteEdge}
                className="border-red-500/30 hover:border-red-500 text-red-400"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
              <Button
                onClick={handleSaveEdge}
                disabled={saving}
                className="bg-gradient-to-r from-[#6EE7F2] to-[#F2B880] hover:from-[#F2B880] hover:to-[#6EE7F2] text-bg-0 font-semibold"
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Wrapper component with ReactFlowProvider
export function StoryGraphManagerWrapper({ worldId }: StoryGraphManagerProps) {
  return (
    <ReactFlowProvider>
      <StoryGraphManager worldId={worldId} />
    </ReactFlowProvider>
  )
}
