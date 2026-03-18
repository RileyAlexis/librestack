import { Controller } from "@hotwired/stimulus";

// Connects to data-controller="reader"
export default class extends Controller {
  static targets = [
    "stage",
    "prevButton",
    "nextButton",
    "pageStatus",
    "fontFamily",
    "fontSize",
    "fontSizeOutput",
    "spread",
  ];

  static values = {
    bookId: String,
    epubUrl: String,
    progressUrl: String,
    spread: { type: String, default: "none" },
  };

  connect() {
    this.book = null;
    this.rendition = null;
    this.publisherPageList = null;
    this.totalBookPages = null;
    this.bookmarks = [];
    this.lastSavedCfi = null;
    this.pendingCfi = null;
    this.resizeTimer = null;
    this.saveProgressTimer = null;
    this.isInitializing = false;
    this.locationGenId = 0;
    this.keyDownHandler = this.onKeydown.bind(this);
    this.resizeHandler = this.onResize.bind(this);

    this.initialize();
  }

  disconnect() {
    window.removeEventListener("keydown", this.keyDownHandler);
    window.removeEventListener("resize", this.resizeHandler);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    if (this.saveProgressTimer) clearTimeout(this.saveProgressTimer);
    if (this.rendition) {
      try {
        this.rendition.destroy();
      } catch {
        /* partially initialized */
      }
    }
    if (this.book) this.book.destroy();
  }

  getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta?.content || "";
  }

  async fetchEpubBinary() {
    const response = await fetch(this.epubUrlValue, {
      headers: {
        Accept: "application/epub+zip,*/*",
      },
      credentials: "same-origin",
    });

    if (!response.ok) {
      throw new Error(`EPUB request failed (${response.status})`);
    }

    return response.arrayBuffer();
  }

  async loadProgressFromDb() {
    if (!this.progressUrlValue) return null;

    try {
      const response = await fetch(this.progressUrlValue, {
        headers: {
          Accept: "application/json",
        },
        credentials: "same-origin",
      });

      if (!response.ok) return null;

      const data = await response.json();
      this.bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
      this.lastSavedCfi = data.last_cfi || null;
      return data.last_cfi || null;
    } catch {
      return null;
    }
  }

  async saveProgressToDb({ cfi, bookmarks } = {}) {
    if (!this.progressUrlValue) return;

    const payload = {};
    if (typeof cfi === "string") payload.last_cfi = cfi;
    if (Array.isArray(bookmarks)) payload.bookmarks = bookmarks;
    if (Object.keys(payload).length === 0) return;

    try {
      await fetch(this.progressUrlValue, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": this.getCsrfToken(),
        },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });

      if (payload.last_cfi) {
        this.lastSavedCfi = payload.last_cfi;
      }
    } catch {
      // Ignore transient network failures; next relocation will retry.
    }
  }

  queueSaveCfi(cfi) {
    if (!cfi || cfi === this.lastSavedCfi) return;
    this.pendingCfi = cfi;
    if (this.saveProgressTimer) clearTimeout(this.saveProgressTimer);

    this.saveProgressTimer = setTimeout(() => {
      const toSave = this.pendingCfi;
      this.pendingCfi = null;
      if (toSave) {
        this.saveProgressToDb({ cfi: toSave });
      }
    }, 350);
  }

  updateStatus(location) {
    const displayed = location?.start?.displayed;
    const cfi = location?.start?.cfi;

    if (cfi) this.queueSaveCfi(cfi);

    const chapterText = displayed?.total
      ? `Chapter ${displayed.page}/${displayed.total}`
      : null;

    if (cfi && this.publisherPageList) {
      const publisherPage = this.publisherPageList.pageFromCfi(cfi);
      if (typeof publisherPage === "number" && publisherPage > 0) {
        const lastPublisherPage =
          this.publisherPageList.lastPage || publisherPage;
        this.pageStatusTarget.textContent = chapterText
          ? `Page ${publisherPage}/${lastPublisherPage} • ${chapterText}`
          : `Page ${publisherPage}/${lastPublisherPage}`;
        return;
      }
    }

    if (!cfi || !this.book?.locations || !this.totalBookPages) {
      this.pageStatusTarget.textContent = chapterText || "Reading";
      return;
    }

    const globalIndex = this.book.locations.locationFromCfi(cfi);
    if (typeof globalIndex !== "number" || globalIndex < 0) {
      this.pageStatusTarget.textContent = chapterText || "Reading";
      return;
    }

    const globalPage = globalIndex + 1;

    this.pageStatusTarget.textContent = chapterText
      ? `Page ${globalPage}/${this.totalBookPages} • ${chapterText}`
      : `Page ${globalPage}/${this.totalBookPages}`;
  }

  async generateBookLocations() {
    if (!this.book) return;

    const genId = ++this.locationGenId;

    await this.book.ready;
    if (!this.book || this.locationGenId !== genId) return;

    if (this.book.loaded?.pageList) {
      await this.book.loaded.pageList;
      if (!this.book || this.locationGenId !== genId) return;
      const pageList = this.book.pageList;
      if (
        pageList &&
        Array.isArray(pageList.pages) &&
        pageList.pages.length > 0 &&
        Array.isArray(pageList.locations) &&
        pageList.locations.length > 0
      ) {
        this.publisherPageList = pageList;
      }
    }

    if (!this.book || this.locationGenId !== genId) return;
    try {
      await this.book.locations.generate(1024);
    } catch {
      return; // book was destroyed during generation
    }
    if (!this.book || this.locationGenId !== genId) return;
    this.totalBookPages = this.book.locations.length();

    const currentLocation = this.rendition?.currentLocation?.();
    if (currentLocation) {
      this.updateStatus(currentLocation);
    }
  }

  async initialize() {
    // Prevent multiple concurrent initializations
    if (this.isInitializing) {
      console.log("Initialize already in progress, skipping");
      return;
    }
    this.isInitializing = true;

    if (!window.ePub || !this.hasStageTarget || !this.epubUrlValue) {
      this.pageStatusTarget.textContent = "Reader failed to initialize";
      console.error("Init checks failed:", {
        hasEpub: !!window.ePub,
        hasStageTarget: this.hasStageTarget,
        hasEpubUrl: !!this.epubUrlValue,
        stageTarget: this.stageTarget,
      });
      this.isInitializing = false;
      return;
    }

    const FAMILY_KEY = "reader.fontFamily";
    const SIZE_KEY = "reader.fontSize";
    const SPREAD_KEY = "reader.spread";

    const savedFamily = localStorage.getItem(FAMILY_KEY);
    const savedSize = localStorage.getItem(SIZE_KEY);
    const savedSpread = localStorage.getItem(SPREAD_KEY);
    if (savedFamily) this.fontFamilyTarget.value = savedFamily;
    if (savedSize) this.fontSizeTarget.value = savedSize;
    if (savedSpread) this.spreadTarget.value = savedSpread;
    this.fontSizeOutputTarget.textContent = `${this.fontSizeTarget.value}px`;

    console.log("spead", this.spreadTarget.value);

    let epubBinary;
    try {
      epubBinary = await this.fetchEpubBinary();
      console.log(
        "✓ EPUB binary fetched:",
        epubBinary?.byteLength || 0,
        "bytes",
      );
    } catch (error) {
      this.pageStatusTarget.textContent =
        error?.message || "Could not load EPUB file";
      console.error("✗ Fetch EPUB error:", error);
      this.isInitializing = false;
      return;
    }

    this.book = window.ePub();
    try {
      await this.book.open(epubBinary, "binary");
      console.log("✓ EPUB book opened");
    } catch {
      this.pageStatusTarget.textContent = "Could not parse EPUB file";
      console.error("✗ Open EPUB error");
      this.isInitializing = false;
      return;
    }

    // Destroy previous rendition if it exists
    if (this.rendition) {
      try {
        this.rendition.destroy();
      } catch {
        // Rendition may be partially initialized (scroller not yet set up)
      }
      this.rendition = null;
    }

    // Clear the stage to prevent duplicate containers
    this.stageTarget.innerHTML = "";

    try {
      this.rendition = this.book.renderTo(this.stageTarget, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: this.spreadTarget.value === "Double" ? "auto" : "none",
      });
      console.log("✓ Rendition created, rendered to stage");
    } catch (error) {
      this.pageStatusTarget.textContent = "Could not initialize reader";
      console.error("✗ RenderTo error:", error);
      this.isInitializing = false;
      return;
    }

    this.rendition.on("relocated", (location) => {
      this.updateStatus(location);
    });

    const initialCfi = await this.loadProgressFromDb();
    try {
      console.log(
        "Attempting to display content, CFI:",
        initialCfi ? "saved" : "start",
      );
      await this.rendition.display(initialCfi || undefined);
      console.log("✓ Content displayed");

      // Apply font styles after content is rendered
      this.applyTheme();
      console.log("✓ Theme applied");

      // Force layout recalculation after content has been rendered
      this.rendition.resize();
      console.log("✓ Layout resized");

      // Generate locations asynchronously in background
      this.generateBookLocations();
    } catch (error) {
      this.pageStatusTarget.textContent = "Could not display this book";
      console.error("✗ Reader display error:", error);
    }

    window.addEventListener("keydown", this.keyDownHandler);
    window.addEventListener("resize", this.resizeHandler);
    this.isInitializing = false;
    console.log("✓ Reader initialization complete");
  }

  applyTheme() {
    if (!this.rendition) return;

    // In paginated flow, avoid body-level constraints that can interfere
    // with page column calculations. Focus on font controls only.
    this.rendition.themes.default({
      body: {
        "font-family": this.fontFamilyTarget.value,
        "font-size": `${this.fontSizeTarget.value}px`,
        "line-height": "1.5",
      },
    });

    // Ensure dynamic control updates are applied immediately in the rendered spine.
    this.rendition.themes.override("font-family", this.fontFamilyTarget.value);
    this.rendition.themes.fontSize(`${this.fontSizeTarget.value}px`);
  }

  prev(event) {
    event.preventDefault();
    this.rendition?.prev();
  }

  next(event) {
    event.preventDefault();
    this.rendition?.next();
  }

  fontFamilyChanged() {
    localStorage.setItem("reader.fontFamily", this.fontFamilyTarget.value);
    if (this.rendition) {
      this.rendition.themes.override(
        "font-family",
        this.fontFamilyTarget.value,
      );
    }
    this.applyTheme();
  }

  fontSizeChanged() {
    this.fontSizeOutputTarget.textContent = `${this.fontSizeTarget.value}px`;
    localStorage.setItem("reader.fontSize", this.fontSizeTarget.value);
    if (this.rendition) {
      this.rendition.themes.fontSize(`${this.fontSizeTarget.value}px`);
    }
    this.applyTheme();
  }

  onKeydown(event) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.rendition?.prev();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      this.rendition?.next();
    }
  }

  onResize() {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.rendition?.resize("100%", "100%");
    }, 150);
  }

  async reRender(cfi) {
    this.locationGenId++; // abort any in-flight location generation
    if (this.rendition) {
      try {
        this.rendition.destroy();
      } catch {
        /* partially initialized */
      }
      this.rendition = null;
    }

    this.stageTarget.innerHTML = "";
    this.rendition = this.book.renderTo(this.stageTarget, {
      width: "100%",
      height: "100%",
      flow: "paginated",
      spread: this.spreadValue === "Single" ? "none" : "auto",
    });

    this.rendition.on("relocated", (location) => {
      this.updateStatus(location);
    });

    await this.rendition.display(cfi || undefined);
    this.applyTheme();
  }

  async spreadChanged() {
    const newSpread = this.spreadTarget.value;
    localStorage.setItem("reader.spread", newSpread);
    this.spreadValue = newSpread;
    if (this.rendition) {
      const cfi = this.rendition.currentLocation()?.start?.cfi;
      await this.reRender(cfi);
    }
  }
}
