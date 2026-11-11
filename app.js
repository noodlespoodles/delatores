(function () {
  const form = document.querySelector("#repo-form");
  const input = document.querySelector("#repo-url");
  const statusRegion = document.querySelector("#status-region");
  const dashboard = document.querySelector("#dashboard");
  const metricGrid = document.querySelector("#metric-grid");
  const executiveSummary = document.querySelector("#executive-summary");
  const riskList = document.querySelector("#risk-list");
  const questionList = document.querySelector("#question-list");
  const evidenceList = document.querySelector("#evidence-list");
  const sampleButtons = document.querySelectorAll("[data-sample]");
  const printButton = document.querySelector("#print-report");

  const importantDirs = [
    "src",
    "app",
    "lib",
    "packages",
    "services",
    "server",
    "client",
    "web",
    "api"
  ];

  const testPatterns = [
    /(^|\/)(__tests__|tests?|specs?)(\/|$)/i,
    /\.(test|spec)\.[cm]?[jt]sx?$/i,
    /test_.*\.py$/i,
    /_test\.go$/i,
    /Tests?\.cs$/i
  ];

  const ciPatterns = [
    /^\.github\/workflows\//i,
    /^\.gitlab-ci\.yml$/i,
    /^circle\.yml$/i,
    /^\.circleci\//i,
    /^azure-pipelines\.ya?ml$/i,
    /^Jenkinsfile$/i,
    /^\.travis\.yml$/i
  ];

  const dependencyFiles = [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "requirements.txt",
    "pyproject.toml",
    "poetry.lock",
    "Pipfile",
    "Pipfile.lock",
    "Gemfile",
    "Gemfile.lock",
    "go.mod",
    "go.sum",
    "Cargo.toml",
    "Cargo.lock",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "composer.json",
    "composer.lock",
    "Directory.Packages.props",
    "packages.config"
  ];
  const dependencyFileNames = dependencyFiles.map(function (name) {
    return name.toLowerCase();
  });

  const docFiles = [
    "README.md",
    "README.rst",
    "README.txt",
    "CONTRIBUTING.md",
    "docs",
    "documentation",
    "ARCHITECTURE.md",
    "SECURITY.md",
    "CHANGELOG.md"
  ];

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const parsed = parseGitHubUrl(input.value);

    if (!parsed) {
      showStatus("error", "Enter a valid GitHub repository URL such as https://github.com/org/repo.");
      return;
    }

    analyzeRepository(parsed.owner, parsed.repo);
  });

  sampleButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      input.value = button.dataset.sample;
      form.requestSubmit();
    });
  });

  printButton.addEventListener("click", function () {
    window.print();
  });

  function parseGitHubUrl(value) {
    const trimmed = value.trim();
    const match = trimmed.match(
      /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:[/?#].*)?$/i
    );

    if (!match) {
      return null;
    }

    return {
      owner: match[1],
      repo: match[2].replace(/\.git$/i, "")
    };
  }

  async function analyzeRepository(owner, repo) {
    setLoading(true, "Fetching public GitHub signals...");

    try {
      const repoData = await githubFetch(`/repos/${owner}/${repo}`);

      setLoading(true, "Reading repository structure and contributor activity...");
      const [treeData, contributors, languages, contents] = await Promise.all([
        githubFetch(`/repos/${owner}/${repo}/git/trees/${repoData.default_branch}?recursive=1`),
        githubFetch(`/repos/${owner}/${repo}/contributors?per_page=30`),
        githubFetch(`/repos/${owner}/${repo}/languages`),
        githubFetch(`/repos/${owner}/${repo}/contents`).catch(function () {
          return [];
        })
      ]);

      const analysis = buildAnalysis({
        owner,
        repo,
        repoData,
        treeData,
        contributors,
        languages,
        contents
      });

      renderDashboard(analysis);
      showStatus(
        "success",
        `Analysis complete for ${analysis.fullName}. Scores are directional and evidence-backed.`
      );
    } catch (error) {
      dashboard.classList.add("is-hidden");
      showStatus("error", error.message || "Unable to analyze this repository.");
    } finally {
      setLoading(false);
    }
  }

  async function githubFetch(path) {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json"
      }
    });

    if (response.status === 404) {
      throw new Error("Repository not found or not public.");
    }

    if (response.status === 403) {
      throw new Error("GitHub rate limit reached. Try again later or test with a smaller sample.");
    }

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}. Try another public repository.`);
    }

    return response.json();
  }

  function buildAnalysis(context) {
    const contributors = Array.isArray(context.contributors) ? context.contributors : [];
    const languages =
      context.languages && typeof context.languages === "object" && !Array.isArray(context.languages)
        ? context.languages
        : {};
    const files = Array.isArray(context.treeData.tree)
      ? context.treeData.tree.filter(function (entry) {
          return entry.type === "blob";
        })
      : [];
    const paths = files.map(function (file) {
      return file.path;
    });
    const rootItems = Array.isArray(context.contents) ? context.contents : [];

    const testFiles = files.filter(function (file) {
      return testPatterns.some(function (pattern) {
        return pattern.test(file.path);
      });
    });
    const sourceFiles = files.filter(function (file) {
      return isLikelySourceFile(file.path);
    });
    const ciFiles = paths.filter(function (path) {
      return ciPatterns.some(function (pattern) {
        return pattern.test(path);
      });
    });
    const dependencyMatches = paths.filter(function (path) {
      return isDependencyFile(path);
    });
    const docs = detectDocs(paths, rootItems);
    const staleDays = daysSince(context.repoData.pushed_at);
    const ageDays = daysSince(context.repoData.created_at);
    const topContributor = contributors[0];
    const topContributorShare = contributorShare(topContributor, contributors);
    const languageList = Object.entries(languages)
      .sort(function (a, b) {
        return b[1] - a[1];
      })
      .slice(0, 5);
    const structure = inspectStructure(paths);
    const treePartial = context.treeData.truncated === true;

    const metrics = scoreMetrics({
      repoData: context.repoData,
      files,
      sourceFiles,
      testFiles,
      ciFiles,
      dependencyMatches,
      docs,
      staleDays,
      ageDays,
      topContributorShare,
      contributors,
      structure,
      treePartial
    });
    const overallScore = Math.round(
      weightedAverage([
        [metrics.testConfidence.score, 0.2],
        [metrics.deliveryHealth.score, 0.16],
        [metrics.maintainability.score, 0.18],
        [metrics.securityDependency.score, 0.16],
        [metrics.ownershipRisk.score, 0.16],
        [metrics.onboarding.score, 0.14]
      ])
    );
    const risks = buildRisks({
      metrics,
      repoData: context.repoData,
      testFiles,
      sourceFiles,
      ciFiles,
      dependencyMatches,
      docs,
      staleDays,
      topContributor,
      topContributorShare,
      structure,
      treePartial
    });
    const questions = buildQuestions(risks, metrics);
    const summary = buildSummary({
      repoData: context.repoData,
      metrics,
      overallScore,
      languageList,
      sourceFiles,
      testFiles,
      dependencyMatches,
      ciFiles,
      topContributor,
      topContributorShare,
      staleDays,
      treePartial
    });
    const evidence = buildEvidence({
      context,
      docs,
      ciFiles,
      dependencyMatches,
      testFiles,
      sourceFiles,
      languageList,
      topContributor,
      topContributorShare,
      treePartial
    });

    return {
      fullName: context.repoData.full_name,
      owner: context.owner,
      repo: context.repo,
      htmlUrl: context.repoData.html_url,
      description: context.repoData.description,
      overallScore,
      riskLabel: riskLabel(overallScore),
      riskSummary: overallSummary(overallScore, risks),
      metrics,
      summary,
      risks,
      questions,
      evidence
    };
  }

  function scoreMetrics(data) {
    const testRatio =
      data.sourceFiles.length === 0 ? 0 : data.testFiles.length / Math.max(data.sourceFiles.length, 1);
    const docsScore = clamp(data.docs.score, 0, 100);
    const activityScore = data.staleDays <= 14 ? 92 : data.staleDays <= 90 ? 76 : data.staleDays <= 365 ? 46 : 22;
    const ciScore = data.ciFiles.length > 0 ? 86 : 34;
    const dependencyScore = data.dependencyMatches.length > 0 ? 72 : 36;
    const securityDocBonus = data.docs.security ? 14 : 0;
    const sourceVolumePenalty = data.sourceFiles.length > 2000 ? 12 : data.sourceFiles.length > 800 ? 6 : 0;
    const topSharePenalty =
      data.topContributorShare >= 75 ? 40 : data.topContributorShare >= 55 ? 24 : data.topContributorShare >= 35 ? 10 : 0;
    const contributorCount = Array.isArray(data.contributors) ? data.contributors.length : 0;
    const contributorScore =
      contributorCount >= 10 ? 88 : contributorCount >= 5 ? 76 : contributorCount >= 2 ? 58 : 30;
    const structureScore = data.structure.score;
    const treePenalty = data.treePartial ? 8 : 0;

    return {
      testConfidence: {
        label: "Test Confidence",
        score: clamp(Math.round(testRatio * 380 + (data.testFiles.length > 0 ? 26 : 8) - treePenalty), 0, 100),
        detail:
          data.testFiles.length > 0
            ? `${formatNumber(data.testFiles.length)} likely test files found across ${formatNumber(data.sourceFiles.length)} source files.`
            : "No obvious automated test files were found in the public tree."
      },
      deliveryHealth: {
        label: "Delivery Health",
        score: clamp(Math.round(activityScore * 0.55 + ciScore * 0.45), 0, 100),
        detail:
          data.ciFiles.length > 0
            ? `${data.ciFiles.length} CI configuration signal${plural(data.ciFiles.length)} found; last push was ${formatAgo(data.staleDays)}.`
            : `No common CI configuration found; last push was ${formatAgo(data.staleDays)}.`
      },
      maintainability: {
        label: "Maintainability",
        score: clamp(Math.round(structureScore - sourceVolumePenalty - treePenalty), 0, 100),
        detail: data.structure.detail
      },
      securityDependency: {
        label: "Security & Dependencies",
        score: clamp(Math.round(dependencyScore + securityDocBonus - treePenalty), 0, 100),
        detail:
          data.dependencyMatches.length > 0
            ? `${data.dependencyMatches.length} dependency manifest or lockfile signal${plural(data.dependencyMatches.length)} found.`
            : "No common dependency manifest or lockfile was detected."
      },
      ownershipRisk: {
        label: "Ownership Spread",
        score: clamp(Math.round(contributorScore - topSharePenalty), 0, 100),
        detail:
          data.topContributorShare > 0
            ? `Top visible contributor accounts for about ${data.topContributorShare}% of listed contributions.`
            : "Contributor distribution was not available from the public API response."
      },
      onboarding: {
        label: "Onboarding Readiness",
        score: clamp(Math.round(docsScore * 0.76 + (data.dependencyMatches.length > 0 ? 12 : 0) + (data.ciFiles.length > 0 ? 12 : 0)), 0, 100),
        detail: data.docs.detail
      }
    };
  }

  function buildRisks(data) {
    const risks = [];

    if (data.testFiles.length === 0 || data.metrics.testConfidence.score < 45) {
      risks.push({
        title: "Low observable automated test confidence",
        severity: "high",
        detail:
          data.testFiles.length === 0
            ? "The repository tree does not expose obvious unit, integration, or spec files. Business-critical behavior may depend on manual verification."
            : "Tests exist, but their count is low compared with the visible source footprint.",
        evidence: `${formatNumber(data.testFiles.length)} likely test files and ${formatNumber(data.sourceFiles.length)} likely source files.`
      });
    }

    if (data.ciFiles.length === 0) {
      risks.push({
        title: "No common CI pipeline detected",
        severity: "medium",
        detail:
          "Without a visible CI configuration, leaders have less evidence that builds and tests run automatically before changes ship.",
        evidence: "Checked common GitHub Actions, GitLab CI, CircleCI, Azure Pipelines, Jenkins, and Travis paths."
      });
    }

    if (data.dependencyMatches.length === 0) {
      risks.push({
        title: "Dependency management is unclear",
        severity: "medium",
        detail:
          "No common dependency manifest or lockfile was found. That can make upgrade, security, and local setup risk harder to evaluate.",
        evidence: "Checked common package files for Node, Python, Go, Rust, Ruby, Java, PHP, and .NET."
      });
    }

    if (data.topContributorShare >= 55) {
      risks.push({
        title: "High ownership concentration",
        severity: data.topContributorShare >= 75 ? "high" : "medium",
        detail:
          "A large share of visible contribution activity comes from one contributor, which can create continuity and handover risk.",
        evidence: `${data.topContributor.login} represents about ${data.topContributorShare}% of listed contributions.`
      });
    }

    if (data.staleDays > 180) {
      risks.push({
        title: "Recent delivery activity is limited",
        severity: data.staleDays > 365 ? "high" : "medium",
        detail:
          "The default branch has not been pushed recently. That may be normal for stable libraries, but it deserves context for an active product.",
        evidence: `Last push was ${formatAgo(data.staleDays)}.`
      });
    }

    if (data.docs.score < 55) {
      risks.push({
        title: "Onboarding documentation looks thin",
        severity: "medium",
        detail:
          "The repository exposes limited setup, contribution, architecture, or security documentation. New hires may need direct developer support to become effective.",
        evidence: data.docs.detail
      });
    }

    if (data.structure.score < 55) {
      risks.push({
        title: "Project structure may slow comprehension",
        severity: "medium",
        detail:
          "The visible tree does not strongly indicate conventional source boundaries. That can make architecture harder to explain to non-authors.",
        evidence: data.structure.detail
      });
    }

    if (data.treePartial) {
      risks.push({
        title: "Repository is too large for full public tree scan",
        severity: "medium",
        detail:
          "GitHub returned a truncated file tree, so file-count-based scores may understate tests, docs, or dependency signals.",
        evidence: "GitHub tree API reported truncated=true."
      });
    }

    if (risks.length === 0) {
      risks.push({
        title: "No severe public-signal risks detected",
        severity: "low",
        detail:
          "The repository shows reasonable baseline signals. A private repo assessment should still inspect coverage, vulnerabilities, deployment, and architecture depth.",
        evidence: "Public metadata, tree, CI, documentation, and contribution signals did not trigger high-severity rules."
      });
    }

    return risks.slice(0, 8);
  }

  function buildQuestions(risks, metrics) {
    const questions = [];

    risks.forEach(function (risk) {
      if (/test/i.test(risk.title)) {
        questions.push("Which critical user journeys are covered by automated tests, and where can we see those tests passing?");
      }

      if (/CI|pipeline/i.test(risk.title)) {
        questions.push("What automated checks must pass before code is merged or deployed?");
      }

      if (/Dependency/i.test(risk.title)) {
        questions.push("Who owns dependency upgrades and vulnerability response, and how often is that reviewed?");
      }

      if (/ownership/i.test(risk.title)) {
        questions.push("Which parts of the system depend on one person, and what is the handover plan?");
      }

      if (/delivery|activity/i.test(risk.title)) {
        questions.push("Is this repository still active product code, and where is current development happening?");
      }

      if (/documentation|Onboarding/i.test(risk.title)) {
        questions.push("Can a new developer set this project up from the README without private knowledge?");
      }

      if (/structure|comprehension/i.test(risk.title)) {
        questions.push("Where is the architecture documented, and which modules are considered business-critical?");
      }
    });

    questions.push("What would break first if the most active maintainer were unavailable for two weeks?");
    questions.push("Which risk on this report does the engineering team believe is overstated, and what evidence supports that?");

    return unique(questions).slice(0, 7);
  }

  function buildSummary(data) {
    const primaryLanguage = data.languageList.length > 0 ? data.languageList[0][0] : "Unknown";
    const summary = [
      {
        title: "Repository profile",
        detail: `${data.repoData.full_name} is primarily ${primaryLanguage}, with ${formatNumber(data.sourceFiles.length)} likely source files and ${formatNumber(data.testFiles.length)} likely test files visible.`
      },
      {
        title: "Business interpretation",
        detail: `${data.overallScore}/100 indicates ${riskLabel(data.overallScore).toLowerCase()}. Treat this as a question map for leadership, not a final verdict on engineering quality.`
      },
      {
        title: "Operating signals",
        detail: `${data.ciFiles.length > 0 ? "CI configuration is visible" : "CI configuration was not detected"}; ${data.dependencyMatches.length > 0 ? "dependency manifests are visible" : "dependency management is unclear"}; last push was ${formatAgo(data.staleDays)}.`
      }
    ];

    if (data.topContributor && data.topContributorShare > 0) {
      summary.push({
        title: "Knowledge concentration",
        detail: `The top visible contributor, ${data.topContributor.login}, accounts for about ${data.topContributorShare}% of listed contributions.`
      });
    }

    if (data.treePartial) {
      summary.push({
        title: "Confidence note",
        detail:
          "GitHub returned a truncated file tree, so some file-based conclusions need verification with a full clone or authenticated scan."
      });
    }

    return summary;
  }

  function buildEvidence(data) {
    const repoUrl = data.context.repoData.html_url;
    const evidence = [
      {
        title: "Repository metadata",
        detail: `${formatNumber(data.context.repoData.stargazers_count)} stars, ${formatNumber(data.context.repoData.forks_count)} forks, ${formatNumber(data.context.repoData.open_issues_count)} open issues, default branch ${data.context.repoData.default_branch}.`,
        url: repoUrl
      },
      {
        title: "Language profile",
        detail:
          data.languageList.length > 0
            ? data.languageList.map(function (entry) {
                return entry[0];
              }).join(", ")
            : "No language breakdown returned by GitHub.",
        url: `${repoUrl}/search?type=code`
      },
      {
        title: "Documentation signals",
        detail: data.docs.detail,
        url: repoUrl
      },
      {
        title: "Test signals",
        detail: `${formatNumber(data.testFiles.length)} likely test files found. Sample: ${samplePaths(data.testFiles.map(function (file) {
          return file.path;
        }))}`,
        url: `${repoUrl}/search?q=test&type=code`
      },
      {
        title: "CI signals",
        detail: data.ciFiles.length > 0 ? samplePaths(data.ciFiles) : "No common CI files found.",
        url: `${repoUrl}/actions`
      },
      {
        title: "Dependency signals",
        detail: data.dependencyMatches.length > 0 ? samplePaths(data.dependencyMatches) : "No common dependency files found.",
        url: `${repoUrl}/search?q=package&type=code`
      }
    ];

    if (data.topContributor && data.topContributorShare > 0) {
      evidence.push({
        title: "Visible contributor concentration",
        detail: `${data.topContributor.login}: about ${data.topContributorShare}% of listed contributions.`,
        url: `${repoUrl}/graphs/contributors`
      });
    }

    if (data.treePartial) {
      evidence.push({
        title: "Partial scan warning",
        detail: "GitHub tree API returned truncated=true, so authenticated backend scanning should be used for diligence-grade results.",
        url: repoUrl
      });
    }

    return evidence;
  }

  function renderDashboard(analysis) {
    document.querySelector("#repo-owner").textContent = analysis.owner;
    document.querySelector("#repo-name").textContent = analysis.repo;
    document.querySelector("#repo-link").href = analysis.htmlUrl;
    document.querySelector("#score-value").textContent = analysis.overallScore;
    document.querySelector("#risk-label").textContent = analysis.riskLabel;
    document.querySelector("#risk-summary").textContent = analysis.riskSummary;

    const overall = document.querySelector(".overall-score");
    overall.style.setProperty("--score-angle", `${analysis.overallScore * 3.6}deg`);
    overall.dataset.tone = toneForScore(analysis.overallScore);

    metricGrid.replaceChildren(
      ...Object.values(analysis.metrics).map(function (metric) {
        return metricCard(metric);
      })
    );
    executiveSummary.replaceChildren(
      ...analysis.summary.map(function (item) {
        return infoItem("summary-item", item);
      })
    );
    riskList.replaceChildren(
      ...analysis.risks.map(function (risk) {
        const node = infoItem("risk-item", risk);
        node.dataset.severity = risk.severity;
        return node;
      })
    );
    questionList.replaceChildren(
      ...analysis.questions.map(function (question) {
        const li = document.createElement("li");
        li.textContent = question;
        return li;
      })
    );
    evidenceList.replaceChildren(
      ...analysis.evidence.map(function (item) {
        const article = document.createElement("article");
        article.className = "evidence-item";
        const title = document.createElement("strong");
        title.textContent = item.title;
        const detail = document.createElement("p");
        detail.textContent = item.detail;
        const link = document.createElement("a");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = "Open evidence";
        article.append(title, detail, link);
        return article;
      })
    );

    dashboard.classList.remove("is-hidden");
  }

  function metricCard(metric) {
    const card = document.createElement("article");
    card.className = "metric-card";
    card.dataset.tone = toneForScore(metric.score);

    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = metric.label;
    const score = document.createElement("strong");
    score.textContent = metric.score;
    header.append(title, score);

    const bar = document.createElement("div");
    bar.className = "bar";
    bar.setAttribute("aria-hidden", "true");
    const barFill = document.createElement("span");
    barFill.style.setProperty("--bar-width", `${metric.score}%`);
    bar.append(barFill);

    const detail = document.createElement("p");
    detail.textContent = metric.detail;

    card.append(header, bar, detail);
    return card;
  }

  function infoItem(className, item) {
    const article = document.createElement("article");
    article.className = className;
    const title = document.createElement("strong");
    title.textContent = item.title;
    const detail = document.createElement("p");
    detail.textContent = item.detail;
    article.append(title, detail);

    if (item.evidence) {
      const evidence = document.createElement("p");
      evidence.textContent = item.evidence;
      article.append(evidence);
    }

    return article;
  }

  function detectDocs(paths, rootItems) {
    const rootNames = rootItems.map(function (item) {
      return item.name.toLowerCase();
    });
    const lowerPaths = paths.map(function (path) {
      return path.toLowerCase();
    });
    const hasReadme = rootNames.some(function (name) {
      return /^readme\./.test(name);
    });
    const hasDocsDir = rootNames.includes("docs") || rootNames.includes("documentation");
    const hasContributing = lowerPaths.includes("contributing.md");
    const hasArchitecture = lowerPaths.includes("architecture.md") || lowerPaths.some(function (path) {
      return path.startsWith("docs/architecture");
    });
    const hasSecurity = lowerPaths.includes("security.md") || lowerPaths.some(function (path) {
      return path.startsWith("docs/security");
    });
    const matches = docFiles.filter(function (name) {
      const lower = name.toLowerCase();
      return lowerPaths.includes(lower) || rootNames.includes(lower);
    });
    const score = clamp(
      (hasReadme ? 34 : 0) +
        (hasDocsDir ? 24 : 0) +
        (hasContributing ? 16 : 0) +
        (hasArchitecture ? 14 : 0) +
        (hasSecurity ? 12 : 0),
      0,
      100
    );

    return {
      score,
      security: hasSecurity,
      detail:
        matches.length > 0 || hasReadme || hasDocsDir
          ? `Found ${unique(matches).concat(hasReadme ? ["README"] : []).concat(hasDocsDir ? ["docs directory"] : []).filter(Boolean).slice(0, 6).join(", ")}.`
          : "No README, docs directory, contribution guide, architecture note, or security policy was detected."
    };
  }

  function inspectStructure(paths) {
    const rootDirs = new Set();
    const conventionalDirs = new Set();
    const deeplyNested = [];

    paths.forEach(function (path) {
      const parts = path.split("/");
      if (parts.length > 1) {
        rootDirs.add(parts[0]);
      }

      if (importantDirs.includes(parts[0])) {
        conventionalDirs.add(parts[0]);
      }

      if (parts.length > 7) {
        deeplyNested.push(path);
      }
    });

    const rootDirCount = rootDirs.size;
    const conventionalScore = conventionalDirs.size > 0 ? 36 : 10;
    const spreadScore = rootDirCount <= 4 ? 28 : rootDirCount <= 12 ? 36 : 24;
    const nestingPenalty = deeplyNested.length > 100 ? 16 : deeplyNested.length > 20 ? 8 : 0;
    const score = clamp(conventionalScore + spreadScore + 24 - nestingPenalty, 0, 100);

    return {
      score,
      detail:
        conventionalDirs.size > 0
          ? `Conventional source boundary signal${plural(conventionalDirs.size)} found: ${Array.from(conventionalDirs).join(", ")}.`
          : `${rootDirCount} top-level director${rootDirCount === 1 ? "y" : "ies"} found, but no common source boundary directory was detected.`
    };
  }

  function isLikelySourceFile(path) {
    return /\.(js|jsx|ts|tsx|py|go|rs|rb|php|java|kt|kts|cs|cpp|c|h|hpp|swift|scala|fs|fsx|vb)$/i.test(path);
  }

  function isDependencyFile(path) {
    const name = lastSegment(path).toLowerCase();

    return (
      dependencyFileNames.includes(name) ||
      /\.(csproj|fsproj|vbproj|sln)$/i.test(name) ||
      /^global\.json$/i.test(name)
    );
  }

  function contributorShare(topContributor, contributors) {
    if (!topContributor || !Array.isArray(contributors) || contributors.length === 0) {
      return 0;
    }

    const total = contributors.reduce(function (sum, contributor) {
      return sum + Number(contributor.contributions || 0);
    }, 0);

    if (total === 0) {
      return 0;
    }

    return Math.round((Number(topContributor.contributions || 0) / total) * 100);
  }

  function weightedAverage(values) {
    const totalWeight = values.reduce(function (sum, item) {
      return sum + item[1];
    }, 0);
    const total = values.reduce(function (sum, item) {
      return sum + item[0] * item[1];
    }, 0);

    return total / totalWeight;
  }

  function riskLabel(score) {
    if (score >= 80) {
      return "Low visible risk";
    }

    if (score >= 62) {
      return "Moderate visible risk";
    }

    if (score >= 45) {
      return "Elevated visible risk";
    }

    return "High visible risk";
  }

  function overallSummary(score, risks) {
    const highCount = risks.filter(function (risk) {
      return risk.severity === "high";
    }).length;

    if (score >= 80) {
      return "Public signals show a comparatively strong baseline. Use the report to confirm assumptions with engineering.";
    }

    if (score >= 62) {
      return `Public signals are mixed, with ${highCount} high-priority issue${plural(highCount)} flagged for discussion.`;
    }

    if (score >= 45) {
      return `Several signals deserve leadership attention before relying on this codebase for critical delivery.`;
    }

    return "The public scan found weak baseline evidence for maintainability, delivery, or continuity. This needs deeper review.";
  }

  function toneForScore(score) {
    if (score < 45) {
      return "bad";
    }

    if (score < 70) {
      return "warn";
    }

    return "good";
  }

  function showStatus(type, message) {
    statusRegion.replaceChildren();

    if (!message) {
      return;
    }

    const node = document.createElement("div");
    node.className = "status-message";
    const strong = document.createElement("strong");
    strong.textContent = type === "error" ? "Issue" : type === "success" ? "Done" : "Working";
    const text = document.createElement("span");
    text.textContent = message;
    node.append(strong, text);
    statusRegion.append(node);
  }

  function setLoading(isLoading, message) {
    const button = form.querySelector("button[type='submit']");
    button.disabled = isLoading;

    if (isLoading) {
      statusRegion.replaceChildren();
      const node = document.createElement("div");
      node.className = "status-message";
      const spinner = document.createElement("span");
      spinner.className = "spinner";
      const text = document.createElement("span");
      text.textContent = message;
      node.append(spinner, text);
      statusRegion.append(node);
    }
  }

  function daysSince(dateString) {
    if (!dateString) {
      return 9999;
    }

    const date = new Date(dateString);
    const ms = Date.now() - date.getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  }

  function lastSegment(path) {
    return path.split("/").pop();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat().format(value || 0);
  }

  function formatAgo(days) {
    if (days === 0) {
      return "today";
    }

    if (days === 1) {
      return "1 day ago";
    }

    if (days < 30) {
      return `${days} days ago`;
    }

    if (days < 365) {
      return `${Math.round(days / 30)} months ago`;
    }

    return `${Math.round(days / 365)} years ago`;
  }

  function plural(count) {
    return count === 1 ? "" : "s";
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function samplePaths(paths) {
    if (!paths || paths.length === 0) {
      return "none detected";
    }

    return paths.slice(0, 5).join(", ");
  }
})();
