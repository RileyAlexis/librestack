class FluenttrialController < ApplicationController
  @@dataThing = [
    {
      id: 1,
      display_name: "Alpha User",
      email: "alpha@example.test",
      status: "active",
      plan: "free"
    },
    {
      id: 2,
      display_name: "Beta Person",
      email: "beta@example.test",
      status: "paused",
      plan: "pro"
    },
    {
      id: 3,
      display_name: "Gamma Account",
      email: "gamma@example.test",
      status: "active",
      plan: "team"
    },
    {
      id: 4,
      display_name: "Delta Profile",
      email: "delta@example.test",
      status: "invited",
      plan: "free"
    }
  ]

  def index
    @dataThing = @@dataThing
  end

  def add_data
    Rails.logger.error("fluenttrial#add_data was triggered")
    @@dataThing.push({
      id: 5,
      display_name: "new name",
      email: "thing@thing.com",
      status: "active",
      plan: "free"
    })
    redirect_to fluenttrial_index_path, notice: "Rails action fired."
  end
end
