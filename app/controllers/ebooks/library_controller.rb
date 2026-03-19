# typed: false

module Ebooks
  class LibraryController < ApplicationController
    extend T::Sig
    wrap_parameters false

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
    def reader
      books_source = T.let(Book, T.untyped)
      controller = T.unsafe(self)
      book = books_source.select(:id, :title, :updated_at, :epub_byte_size).find_by(id: controller.params[:id])

      if book.blank? || book.epub_byte_size.to_i == 0
        controller.redirect_to ebooks_library_path, alert: "This book does not have readable EPUB content."
        return
      end

      @book = book
      @epub_url = ebooks_library_book_epub_path(id: book.id, v: book.updated_at&.to_i)
      @reading_progress_url = ebooks_library_book_reading_progress_path(id: book.id)
    end

    sig { void }
    def reading_progress
      books_source = T.let(Book, T.untyped)
      controller = T.unsafe(self)
      book = books_source.select(:id, :user_id).find_by(id: controller.params[:id])

      if book.blank?
        controller.head :not_found
        return
      end

      progress_source = T.let(ReadingProgress, T.untyped)
      progress = progress_source.find_by(user_id: book.user_id, book_id: book.id)

      controller.render json: {
        book_id: book.id,
        user_id: book.user_id,
        last_cfi: progress&.last_cfi,
        bookmarks: progress&.bookmarks || []
      }
    end

    sig { void }
    def update_reading_progress
      books_source = T.let(Book, T.untyped)
      controller = T.unsafe(self)
      book = books_source.select(:id, :user_id).find_by(id: controller.params[:id])

      if book.blank?
        controller.head :not_found
        return
      end

      payload = controller.params.permit(:last_cfi, bookmarks: [])
      bookmarks_param_present = controller.params.key?(:bookmarks)
      sanitized_bookmarks = Array(payload[:bookmarks])
        .map(&:to_s)
        .map(&:strip)
        .reject(&:blank?)
        .uniq
        .first(500)

      progress_source = T.let(ReadingProgress, T.untyped)
      progress = progress_source.find_or_initialize_by(user_id: book.user_id, book_id: book.id)

      progress.last_cfi = payload[:last_cfi].presence if payload.key?(:last_cfi)
      progress.bookmarks = sanitized_bookmarks if bookmarks_param_present
      progress.save!

      controller.render json: {
        book_id: book.id,
        user_id: book.user_id,
        last_cfi: progress.last_cfi,
        bookmarks: progress.bookmarks || []
      }
    rescue StandardError => e
      Rails.logger.error("Reading progress update failed for book #{book&.id}: #{e.class} - #{e.message}")
      controller.render json: { error: "Could not update reading progress." }, status: :unprocessable_entity
    end

    sig { void }
    def epub
      books_source = T.let(Book, T.untyped)
      controller = T.unsafe(self)
      book = books_source
        .select(:id, :updated_at, :epub_data, :epub_byte_size, :epub_content_type, :epub_filename)
        .find_by(id: controller.params[:id])

      if book.blank? || book.epub_data.blank?
        controller.head :not_found
        return
      end

      start_time = Time.now
      stale = controller.stale?(
        etag: [ book.id, book.updated_at&.to_i, book.epub_byte_size ],
        last_modified: book.updated_at,
        public: false
      )
      elapsed = Time.now - start_time
      Rails.logger.info("EPUB stale? check took #{elapsed.round(3)}s for book #{book.id} (#{controller.request.headers['HTTP_IF_NONE_MATCH'].present? ? 'conditional' : 'full'})")

      return unless stale

      send_time = Time.now
      controller.send_data(
        book.epub_data,
        type: book.epub_content_type.presence || "application/epub+zip",
        disposition: "inline",
        filename: book.epub_filename.presence || "book.epub"
      )
      Rails.logger.info("EPUB send_data took #{(Time.now - send_time).round(3)}s for #{book.epub_byte_size} bytes")
    end
  end
end
