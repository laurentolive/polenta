export type ReviewStatus = 'open' | 'approved' | 'closed'
export type ReviewObjectType = 'requirement' | 'test_case'
export type ObjectApprovalStatus = 'pending' | 'quorum_reached' | 'unanimous'

export interface ReviewApproval {
  reviewerId: string
  approvedAt: string
  objectId: string
}

export interface ReviewObject {
  objectId: string
  objectType: ReviewObjectType
  approvals: ReviewApproval[]
  approvalStatus?: ObjectApprovalStatus
}

export interface Review {
  id: string
  projectId?: string
  branchId?: string
  actionId?: string
  title: string
  description: string        // HTML (RICHTEXT)
  status: ReviewStatus
  createdBy: string
  createdAt: string
  dueDate: string | null
  quorum: number | null      // null = unanimité requise
  reviewers: string[]
  objects: ReviewObject[]
}

export interface ReviewCommentReply {
  author: string
  createdAt: string
  content: string            // HTML (RICHTEXT)
}

export interface ReviewComment {
  id: string
  reviewId: string
  objectId: string | null    // null = commentaire au niveau review
  fieldId: string | null     // null = commentaire au niveau objet (pas champ)
  author: string
  createdAt: string
  content: string            // HTML (RICHTEXT)
  resolvedAt: string | null
  resolvedBy: string | null
  replies: ReviewCommentReply[]
}
