# typed: strict

class PagesController < ApplicationController
  # extend T::Sig

  # sig { void }
  def home
  end

  # sig { returns(String) }
  def greeting
    "Hello from PagesController"
  end

  private

  # sig { returns(ActionController::Parameters) }
  def page_params
    params.require(:page).permit(:title, :body)
  end
end
