import type { Review, ReviewStatus } from '@polenta/types'
import type { GitService } from './git.service'
import { assertNewObjectFile, nextCounterId } from './id-counter.util'

export interface CreateReviewDto {
  actionId?: string
  title: string
  description?: string
  reviewers: string[]
  dueDate?: string
  quorum?: number | null
  objects: Array<{
    objectId: string
    objectType: 'requirement' | 'test_case'
    objectVersion: number
  }>
}

export class ReviewsService {
  constructor(private readonly git: GitService) {}

  async create(repoPath: string, dto: CreateReviewDto): Promise<Review> {
    const id = await nextCounterId(this.git, repoPath, 'REVIEW', 'reviews')

    const review: Review = {
      id,
      actionId: dto.actionId,
      title: dto.title,
      description: dto.description ?? '',
      status: 'open',
      createdBy: '',           // caller can set this if needed
      createdAt: new Date().toISOString(),
      dueDate: dto.dueDate ?? null,
      quorum: dto.quorum ?? null,
      reviewers: dto.reviewers,
      objects: dto.objects.map((o) => ({
        objectId: o.objectId,
        objectType: o.objectType,
        objectVersion: o.objectVersion,
        approvals: [],
      })),
    }

    await assertNewObjectFile(this.git, repoPath, `reviews/${id}.yaml`, id)
    await this.git.writeYaml(repoPath, `reviews/${id}.yaml`, review)
    return review
  }

  async findById(repoPath: string, id: string): Promise<Review | null> {
    return this.git.readYaml<Review>(repoPath, `reviews/${id}.yaml`)
  }

  async list(repoPath: string, status?: ReviewStatus): Promise<Review[]> {
    const files = await this.git.listFiles(repoPath, 'reviews')
    const reviews: Review[] = []

    for (const file of files) {
      if (!file.endsWith('.yaml')) continue
      const review = await this.git.readYaml<Review>(repoPath, file)
      if (!review) continue
      if (status && review.status !== status) continue
      reviews.push(review)
    }

    return reviews.sort((a, b) => a.id.localeCompare(b.id))
  }

  async approveObject(
    repoPath: string,
    reviewId: string,
    objectId: string,
    reviewerId: string,
  ): Promise<Review> {
    const review = await this.findById(repoPath, reviewId)
    if (!review) throw new Error(`Review not found: ${reviewId}`)

    const obj = review.objects.find((o) => o.objectId === objectId)
    if (!obj) throw new Error(`Object not found in review: ${objectId}`)

    // Idempotent — don't add duplicate approval
    const alreadyApproved = obj.approvals.some((a) => a.reviewerId === reviewerId)
    if (!alreadyApproved) {
      obj.approvals.push({
        reviewerId,
        approvedAt: new Date().toISOString(),
        objectId,
      })
    }

    await this.git.writeYaml(repoPath, `reviews/${reviewId}.yaml`, review)
    return review
  }

  async revokeApproval(
    repoPath: string,
    reviewId: string,
    objectId: string,
    reviewerId: string,
  ): Promise<Review> {
    const review = await this.findById(repoPath, reviewId)
    if (!review) throw new Error(`Review not found: ${reviewId}`)

    const obj = review.objects.find((o) => o.objectId === objectId)
    if (!obj) throw new Error(`Object not found in review: ${objectId}`)

    obj.approvals = obj.approvals.filter((a) => a.reviewerId !== reviewerId)

    await this.git.writeYaml(repoPath, `reviews/${reviewId}.yaml`, review)
    return review
  }

  async close(repoPath: string, reviewId: string, status: 'approved' | 'closed'): Promise<Review> {
    const review = await this.findById(repoPath, reviewId)
    if (!review) throw new Error(`Review not found: ${reviewId}`)

    review.status = status
    await this.git.writeYaml(repoPath, `reviews/${reviewId}.yaml`, review)
    return review
  }
}
