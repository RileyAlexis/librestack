# typed: false

require "epub/parser"
require "fileutils"
require "nokogiri"
require "open3"
require "tempfile"

class LibraryController < ApplicationController
  extend T::Sig

  sig { void }
  def index
    books_source = T.let(Book, T.untyped)

    @books = T.let(
      books_source
        .includes(:user)
        .order(created_at: :desc)
        .select(
          :id,
          :user_id,
          :title,
          :subtitle,
          :authors,
          :description,
          :publisher,
          :language,
          :isbn,
          :identifier,
          :source_format,
          :spine_page_count,
          :published_at,
          :description,
          :metadata,
          :cover_byte_size,
          :created_at,
          :updated_at
        ),
      T.untyped
    )
  end

  sig { void }
  def cover
    books_source = T.let(Book, T.untyped)
    controller = T.unsafe(self)
    book = books_source
      .select(:id, :updated_at, :cover_data, :cover_byte_size, :cover_content_type, :cover_filename)
      .find_by(id: controller.params[:id])

    if book.blank? || book.cover_data.blank?
      controller.head :not_found
      return
    end

    stale = controller.stale?(
      etag: [ book.id, book.updated_at&.to_i, book.cover_byte_size ],
      last_modified: book.updated_at,
      public: false
    )
    return unless stale

    controller.send_data(
      book.cover_data,
      type: book.cover_content_type.presence || "image/jpeg",
      disposition: "inline",
      filename: book.cover_filename.presence || "cover.jpg"
    )
  end

  sig { void }
  def read
    books_source = T.let(Book, T.untyped)
    controller = T.unsafe(self)
    book = books_source.select(:id, :title, :updated_at, :epub_data).find_by(id: controller.params[:id])

    if book.blank? || book.epub_data.blank?
      controller.redirect_to library_path, alert: "This book does not have readable EPUB content."
      return
    end

    ensure_reader_extraction(book)

    page_param = controller.params[:page].to_i
    result = parse_book_section(book, page_param)

    if result[:error]
      controller.redirect_to library_path, alert: result[:error]
      return
    end

    @book = book
    @total_pages = result[:total_pages]
    @page_number = result[:page_number]
    @section_html = result[:section_html]
  end

  sig { void }
  def read_asset
    books_source = T.let(Book, T.untyped)
    controller = T.unsafe(self)
    book = books_source.select(:id, :updated_at, :epub_data).find_by(id: controller.params[:id])

    if book.blank? || book.epub_data.blank?
      controller.head :not_found
      return
    end

    extraction_dir = ensure_reader_extraction(book)
    asset_path = controller.params[:asset_path].to_s
    if controller.params[:format].present?
      asset_path = "#{asset_path}.#{controller.params[:format]}"
    end

    full_path = safe_reader_asset_path(extraction_dir, asset_path)
    if full_path.blank? || !File.file?(full_path)
      controller.head :not_found
      return
    end

    controller.send_file(full_path, type: mime_type_for_reader(full_path), disposition: "inline")
  end

  private

  def reader_root_dir
    Rails.root.join("tmp", "book_reader_assets").to_s
  end

  def extraction_dir_for(book)
    File.expand_path(File.join(reader_root_dir, "book-#{book.id}-#{book.updated_at&.to_i || 0}"))
  end

  def ensure_reader_extraction(book)
    extraction_dir = extraction_dir_for(book)
    marker = File.join(extraction_dir, ".ready")
    return extraction_dir if File.file?(marker)

    FileUtils.rm_rf(extraction_dir)
    FileUtils.mkdir_p(extraction_dir)

    Tempfile.create([ "library-book-#{book.id}", ".epub" ]) do |tmp_epub|
      tmp_epub.binmode
      tmp_epub.write(book.epub_data)
      tmp_epub.flush

      stdout, stderr, status = Open3.capture3("unzip", "-qq", "-o", tmp_epub.path, "-d", extraction_dir)
      unless status.success?
        message = stderr.to_s.strip
        message = stdout.to_s.strip if message.empty?
        message = "unknown unzip failure" if message.empty?
        raise "reader unzip failed: #{message}"
      end
    end

    File.write(marker, "ready")
    extraction_dir
  end

  def parse_book_section(book, requested_page)
    Tempfile.create([ "reader-section-#{book.id}", ".epub" ]) do |tmp|
      tmp.binmode
      tmp.write(book.epub_data)
      tmp.flush

      parser_class = Object.const_get("EPUB").const_get("Parser")
      parsed = parser_class.parse(tmp.path)

      spine_items = []
      parsed.each_page_on_spine do |item|
        mt = item.media_type.to_s
        next unless mt.include?("xhtml") || mt.include?("html")
        spine_items << item
      end

      return { error: "No readable pages found in this EPUB." } if spine_items.empty?

      total = spine_items.length
      page_number = requested_page.positive? ? [ requested_page, total ].min : 1
      page_number = 1 if page_number < 1

      html = extract_section_html(spine_items[page_number - 1], book)
      { total_pages: total, page_number: page_number, section_html: html }
    end
  rescue => e
    Rails.logger.error("Reader section parse failed for book #{book.id}: #{e.class} - #{e.message}")
    { error: "Could not read this book section." }
  end

  def extract_section_html(item, book)
    raw = item.read.to_s.force_encoding("UTF-8").encode("UTF-8", invalid: :replace, undef: :replace)
    noko_html = Object.const_get("Nokogiri").const_get("HTML")
    doc = noko_html.parse(raw)

    doc.css("script").remove
    doc.css("base").remove

    item_dir = File.dirname(item.entry_name.to_s)
    item_dir = "" if item_dir == "."

    doc.css("img[src]").each do |el|
      src = el["src"].to_s
      next if src.start_with?("http://", "https://", "//", "data:")
      el["src"] = resolve_epub_asset_path(src, item_dir, book)
    end

    body = doc.at_css("body")
    body ? body.inner_html : raw
  end

  def resolve_epub_asset_path(relative_src, item_dir, book)
    base = item_dir.empty? ? "/" : "/#{item_dir}/"
    expanded = File.expand_path(relative_src, base).delete_prefix("/")
    library_book_read_asset_path(id: book.id, asset_path: expanded)
  end

  def safe_reader_asset_path(extraction_dir, asset_path)
    return nil if extraction_dir.blank? || asset_path.blank?

    base_dir = File.expand_path(extraction_dir)
    requested_path = File.expand_path(asset_path.to_s, base_dir)
    return nil unless requested_path.start_with?("#{base_dir}/")

    requested_path
  end

  def mime_type_for_reader(path)
    rack_mime = Object.const_get("Rack").const_get("Mime")
    mime = rack_mime.mime_type(File.extname(path), "application/octet-stream")
    text_like = mime.start_with?("text/") || mime == "application/xhtml+xml" || mime.end_with?("+xml") || mime == "application/xml"
    text_like ? "#{mime}; charset=utf-8" : mime
  end
end
