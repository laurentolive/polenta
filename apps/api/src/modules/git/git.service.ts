import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { simpleGit, SimpleGit } from 'simple-git'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as yaml from 'js-yaml'

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name)
  private readonly reposBasePath: string

  constructor(private readonly config: ConfigService) {
    this.reposBasePath = config.getOrThrow('GIT_REPOS_BASE_PATH')
  }

  repoPath(projectId: string): string {
    return path.join(this.reposBasePath, projectId)
  }

  git(projectId: string): SimpleGit {
    return simpleGit(this.repoPath(projectId))
  }

  async initRepo(projectId: string): Promise<void> {
    const repoDir = this.repoPath(projectId)
    await fs.mkdir(repoDir, { recursive: true })
    const git = simpleGit(repoDir)
    // -b main sets the initial branch name (git >= 2.28)
    // Fallback: set HEAD ref manually for older git
    try {
      await git.init(['-b', 'main'])
    } catch {
      await git.init()
      await git.raw(['symbolic-ref', 'HEAD', 'refs/heads/main'])
    }
    await git.addConfig('user.name', 'Polenta')
    await git.addConfig('user.email', 'polenta@system')
  }

  private async hasCommits(projectId: string): Promise<boolean> {
    return this.hasCommitsAt(this.repoPath(projectId))
  }

  private async hasCommitsAt(repoDir: string): Promise<boolean> {
    try {
      await simpleGit(repoDir).raw(['rev-parse', '--verify', 'HEAD'])
      return true
    } catch {
      return false
    }
  }

  async listFiles(projectId: string, ref: string, prefix?: string): Promise<string[]> {
    try {
      const output = await this.git(projectId).raw(['ls-tree', '-r', '--name-only', ref])
      const files = output.split('\n').filter(Boolean)
      return prefix ? files.filter((f) => f.startsWith(prefix)) : files
    } catch {
      return []
    }
  }

  async readYaml<T>(projectId: string, ref: string, filePath: string): Promise<T | null> {
    try {
      const content = await this.git(projectId).show([`${ref}:${filePath}`])
      return yaml.load(content) as T
    } catch {
      return null
    }
  }

  async createBranch(projectId: string, branchName: string, fromRef: string): Promise<void> {
    const git = this.git(projectId)
    // Create and switch to new branch from the given ref
    await git.checkoutBranch(branchName, fromRef)
    // Switch back to the source ref so the working tree stays consistent
    await git.checkout(fromRef)
  }

  async checkout(projectId: string, ref: string): Promise<void> {
    await this.git(projectId).checkout(ref)
  }

  async writeAndCommit(
    projectId: string,
    branch: string,
    files: Array<{ path: string; content: unknown }>,
    message: string,
    author: { name: string; email: string },
    /** Override the repo directory — used when writing to a component repo instead of the product repo. */
    repoDir?: string,
  ): Promise<string> {
    const effectiveRepoDir = repoDir ?? this.repoPath(projectId)
    const git = simpleGit(effectiveRepoDir)

    // Only checkout if the repo already has commits (not an empty repo)
    if (await this.hasCommitsAt(effectiveRepoDir)) {
      await git.checkout(branch)
    }

    for (const file of files) {
      const fullPath = path.join(effectiveRepoDir, file.path)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, yaml.dump(file.content), 'utf-8')
      await git.add(file.path)
    }

    const result = await git.commit(message, {
      '--author': `${author.name} <${author.email}>`,
    })

    this.logger.debug(`Commit ${result.commit} on ${branch} in ${effectiveRepoDir}: ${message}`)
    return result.commit
  }

  async merge(
    projectId: string,
    targetBranch: string,
    sourceBranch: string,
  ): Promise<{ success: boolean; conflicts: string[] }> {
    const git = this.git(projectId)
    await git.checkout(targetBranch)

    try {
      await git.merge([sourceBranch, '--no-ff'])
      return { success: true, conflicts: [] }
    } catch {
      const status = await git.status()
      return { success: false, conflicts: status.conflicted }
    }
  }

  async tag(projectId: string, tagName: string, ref: string): Promise<void> {
    await this.git(projectId).tag([tagName, ref])
  }

  async currentBranch(projectId: string): Promise<string> {
    const status = await this.git(projectId).status()
    return status.current ?? 'main'
  }
}
