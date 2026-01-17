import {
	type MarkdownPostProcessorContext,
	MarkdownRenderChild,
	type MarkdownSectionInformation,
	type TFile,
	parseLinktext,
} from "obsidian";
import { getSNWCacheByFile, parseLinkTextToFullPath } from "../indexer";
import type SNWPlugin from "../main";
import { htmlDecorationForReferencesElement } from "./htmlDecorations";

let plugin: SNWPlugin;

export function setPluginVariableForMarkdownPreviewProcessor(snwPlugin: SNWPlugin) {
	plugin = snwPlugin;
}

/**
 * Function called by main.registerMarkdownPostProcessor
 */
export default function markdownPreviewProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
	// @ts-ignore
	if (ctx.remainingNestLevel === 4) return;
	if (el.hasAttribute("uic")) return;
	if (el.querySelectorAll(".contains-task-list").length > 0) return;

	const currentFile = plugin.app.vault.fileMap[ctx.sourcePath];
	if (currentFile === undefined) {
		ctx.addChild(new snwChildComponentMardkownWithoutFile(el));
	} else {
		if (plugin.settings.pluginSupportKanban === false) {
			const fileCache = plugin.app.metadataCache.getFileCache(currentFile);
			if (fileCache?.frontmatter?.["kanban-plugin"]) return;
		}
		ctx.addChild(new snwChildComponentForMarkdownFile(el, ctx.getSectionInfo(el), currentFile));
	}
}

class snwChildComponentMardkownWithoutFile extends MarkdownRenderChild {
	containerEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		super(containerEl);
		this.containerEl = containerEl;
	}

	onload(): void {
		for (const link of Array.from(this.containerEl.querySelectorAll("a.internal-link, span.internal-embed"))) {
			const ref = ((link as HTMLElement).dataset.href || link.getAttribute("src")) as string;
			const key = parseLinkTextToFullPath(ref).toLocaleUpperCase();
			const resolvedTFile = plugin.app.metadataCache.getFirstLinkpathDest(parseLinktext(ref).path, "/");
			const references = plugin.snwAPI.references.get(key);

			const refCount = references?.length || 0;
			if (refCount <= 0 || refCount < plugin.settings.minimumRefCountThreshold) continue;

			const refType = link.classList.contains("internal-link") ? "link" : "embed";
			if (!resolvedTFile) continue;

			const referenceElement = htmlDecorationForReferencesElement(
				refCount,
				refType,
				ref,
				key,
				resolvedTFile.path,
				`snw-liveupdate snw-${refType}-preview`,
				1,
			);
			link.after(referenceElement);
		}
	}
}

class snwChildComponentForMarkdownFile extends MarkdownRenderChild {
	containerEl: HTMLElement;
	sectionInfo: MarkdownSectionInformation | null;
	currentFile: TFile;

	constructor(containerEl: HTMLElement, sectionInfo: MarkdownSectionInformation | null, currentFile: TFile) {
		super(containerEl);
		this.containerEl = containerEl;
		this.sectionInfo = sectionInfo;
		this.currentFile = currentFile;
	}

	onload(): void {
		const minRefCountThreshold = plugin.settings.minimumRefCountThreshold;
		const transformedCache = getSNWCacheByFile(this.currentFile);

		if (transformedCache?.cacheMetaData?.frontmatter?.["snw-file-exclude"] === true) return;
		if (transformedCache?.cacheMetaData?.frontmatter?.["snw-canvas-exclude-preview"] === true) return;

		if (transformedCache?.blocks || transformedCache.embeds || transformedCache.headings || transformedCache.links) {
			if (plugin.settings.enableRenderingBlockIdInMarkdown && transformedCache?.blocks && this.sectionInfo) {
				for (const value of transformedCache.blocks) {
					if (
						value.references.length >= minRefCountThreshold &&
						value.pos.start.line >= this.sectionInfo?.lineStart &&
						value.pos.end.line <= this.sectionInfo?.lineEnd
					) {
						const referenceElement = htmlDecorationForReferencesElement(
							value.references.length,
							"block",
							value.references[0].realLink,
							value.key,
							value.references[0]?.resolvedFile?.path ?? "",
							"snw-liveupdate",
							value.pos.start.line,
						);

						// --- 修改开始：更精确的元素查找逻辑 ---
						const valueLineInSection: number = value.pos.start.line - this.sectionInfo.lineStart;

						// 1. 优先尝试通过 data-line 查找精确的行元素 (p, li, div 等)
						let blockElement: HTMLElement | null = this.containerEl.querySelector(`[data-line="${valueLineInSection}"]`);

						// 2. 如果没找到，回退到查找段落 (旧逻辑)
						if (!blockElement) {
							blockElement = this.containerEl.querySelector("p");
						}

						// 3. 执行插入
						if (blockElement) {
							// 检查是否是列表项内的容器
							const ulElement = blockElement.querySelector("ul");
							if (ulElement) {
								ulElement.before(referenceElement);
							} else {
								// 使用新的安全插入函数
								injectRefRespectingColon(blockElement, referenceElement);
							}

							if (!blockElement.hasClass("snw-block-preview")) {
								// 注意：不要给 blockElement 加 flex 类，否则会导致整行变成 flex 布局
								// 我们只标记它，样式处理交给 CSS
								// referenceElement.addClass("snw-block-preview"); // 原逻辑似乎是给 ref 加类
							}
							referenceElement.addClass("snw-block-preview");
						}
						// --- 修改结束 ---
					}
				}
			}

			if (plugin.settings.enableRenderingEmbedsInMarkdown && transformedCache?.embeds) {
				this.containerEl.querySelectorAll(".internal-embed:not(.snw-embed-preview)").forEach((element) => {
					const src = element.getAttribute("src");
					if (!src) return;
					const embedKey =
						parseLinkTextToFullPath(
							src[0] === "#" ? this.currentFile.path.slice(0, -(this.currentFile.extension.length + 1)) + src : src,
						) || src;

					for (const value of transformedCache.embeds ?? []) {
						if (value.references.length >= minRefCountThreshold && embedKey.toLocaleUpperCase() === value.key.toLocaleUpperCase()) {
							const referenceElement = htmlDecorationForReferencesElement(
								value.references.length,
								"embed",
								value.references[0].realLink,
								value.key.toLocaleUpperCase(),
								value.references[0]?.resolvedFile?.path ?? "",
								"snw-liveupdate",
								value.pos.start.line,
							);
							referenceElement.addClass("snw-embed-preview");
							element.after(referenceElement);
							break;
						}
					}
				});
			}

			if (plugin.settings.enableRenderingLinksInMarkdown && transformedCache?.links) {
				this.containerEl.querySelectorAll("a.internal-link").forEach((element) => {
					const dataHref = element.getAttribute("data-href");
					if (!dataHref) return;
					const link =
						parseLinkTextToFullPath(
							dataHref[0] === "#" ? this.currentFile.path.slice(0, -(this.currentFile.extension.length + 1)) + dataHref : dataHref,
						) || dataHref;

					for (const value of transformedCache.links ?? []) {
						if (
							value.references.length >= Math.max(2, minRefCountThreshold) &&
							value.key.toLocaleUpperCase() === link.toLocaleUpperCase()
						) {
							const referenceElement = htmlDecorationForReferencesElement(
								value.references.length,
								"link",
								value.references[0].realLink,
								value.key.toLocaleUpperCase(),
								value.references[0]?.resolvedFile?.path ?? "",
								"snw-liveupdate",
								value.pos.start.line,
							);
							referenceElement.addClass("snw-link-preview");
							element.after(referenceElement);
							break;
						}
					}
				});
			}

			if (plugin.settings.enableRenderingHeadersInMarkdown) {
				const headerKey = this.containerEl.querySelector("[data-heading]");
				if (transformedCache?.headings && headerKey) {
					const textContext = headerKey.getAttribute("data-heading");

					for (const value of transformedCache.headings) {
						if (value.references.length >= minRefCountThreshold && value.headerMatch === textContext?.replace(/\[|\]/g, "")) {
							const referenceElement = htmlDecorationForReferencesElement(
								value.references.length,
								"heading",
								value.references[0].realLink,
								value.key,
								value.references[0]?.resolvedFile?.path ?? "",
								"snw-liveupdate",
								value.pos.start.line,
							);
							referenceElement.addClass("snw-heading-preview");
							const headerElement = this.containerEl.querySelector("h1,h2,h3,h4,h5,h6");
							if (headerElement) {
								headerElement.insertAdjacentElement("beforeend", referenceElement);
							}
							break;
						}
					}
				}
			}
		}
	}
}

/**
 * 辅助函数：安全地将角标插入到冒号之前
 * 使用 splitText 避免直接修改 textContent 导致的内容丢失风险
 */
function injectRefRespectingColon(container: HTMLElement, refEl: HTMLElement) {
    if (!container) return;

    // 1. 获取容器的最后一个子节点
    let lastNode = container.lastChild;

    // 2. 向前跳过空文本节点或换行符
    while (lastNode && (lastNode.nodeType !== Node.TEXT_NODE || !lastNode.textContent?.trim())) {
        lastNode = lastNode.previousSibling;
    }

    // 3. 如果找到了文本节点
    if (lastNode && lastNode.nodeType === Node.TEXT_NODE) {
        const text = lastNode.textContent!;
        // 匹配结尾的冒号（兼容中英文），忽略末尾空格
        const match = text.match(/([：:])(\s*)$/);

        if (match) {
            const splitIndex = match.index!;
            // 关键步骤：在冒号位置将文本节点一分为二
            // node1 保留冒号前的内容
            // node2 (colonNode) 包含冒号及之后的空格
            const colonNode = (lastNode as Text).splitText(splitIndex);

            // 将角标插入到 colonNode (冒号) 之前
            container.insertBefore(refEl, colonNode);
            return;
        }
    }

    // 4. 默认兜底：直接追加到末尾
    container.appendChild(refEl);
}
